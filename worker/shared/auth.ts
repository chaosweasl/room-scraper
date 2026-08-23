import { Page } from "playwright";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const STORAGE_DIR = process.env.AUTH_STORAGE_DIR || "/app/data/auth";

interface AuthConfig {
  loginUrl: string;
  emailEnv: string;
  passwordEnv: string;
  emailSelector: string;
  passwordSelector: string;
  submitSelector: string;
  loggedInSelector: string;
}

// Login flow config per source. Selectors are best-effort and may need tuning
// for the live site; the helper is defensive and falls back to anonymous scraping.
const AUTH_CONFIGS: Record<string, AuthConfig> = {
  roomspot: {
    loginUrl: "https://www.roomspot.nl/en/login",
    emailEnv: "ROOMSPOT_EMAIL",
    passwordEnv: "ROOMSPOT_PASSWORD",
    emailSelector: "input[type='email'], input[name='email']",
    passwordSelector: "input[type='password'], input[name='password']",
    submitSelector:
      "button[type='submit'], button:has-text('Login'), button:has-text('Inloggen')",
    loggedInSelector: ".user-menu, .account-menu, [data-logged-in='true']",
  },
};

function storagePath(source: string): string {
  return join(STORAGE_DIR, `${source}-state.json`);
}

/**
 * Best-effort lazy authentication. Returns true if the page is (now) logged in.
 * Loads any persisted storage state, checks the logged-in selector, and — only
 * when credentials are available — performs a login and persists the session.
 */
export async function ensureLoggedIn(
  page: Page,
  source: string,
): Promise<boolean> {
  const config = AUTH_CONFIGS[source];
  if (!config) return true; // source doesn't need auth

  // 1. Restore a previously saved session if present.
  const stateFile = storagePath(source);
  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(readFileSync(stateFile, "utf-8"));
      if (Array.isArray(state.cookies) && state.cookies.length > 0) {
        await page.context().addCookies(state.cookies);
      }
    } catch {
      // Corrupt state file — ignore and continue
    }
  }

  // 2. Already logged in?
  try {
    if ((await page.locator(config.loggedInSelector).count()) > 0) {
      return true;
    }
  } catch {
    // selector may not exist — continue
  }

  // 3. Credentials required for login.
  const email = process.env[config.emailEnv];
  const password = process.env[config.passwordEnv];
  if (!email || !password) {
    return false; // anonymous mode — don't navigate away from the listing page
  }

  try {
    await page.goto(config.loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.fill(config.emailSelector, email);
    await page.fill(config.passwordSelector, password);
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 })
        .catch(() => undefined),
      page.click(config.submitSelector),
    ]);
  } catch (err) {
    console.warn(`⚠️ ${source} login failed — continuing anonymously:`, err);
    return false;
  }

  // 4. Persist the new session.
  try {
    const state = await page.context().storageState();
    mkdirSync(STORAGE_DIR, { recursive: true });
    writeFileSync(stateFile, JSON.stringify(state));
  } catch {
    // non-fatal
  }

  return true;
}
