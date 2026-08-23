import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { Page } from "playwright";
import { Listing } from "./db";
import { ensureLoggedIn } from "./auth";

chromium.use(stealthPlugin());

export interface SubmitResult {
  success: boolean;
  screenshotPath?: string;
  message: string;
}

const STEALTH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-blink-features=AutomationControlled",
];

/**
 * Human-in-the-loop auto-submit. Navigates to the listing, fills the platform's
 * contact form with the Hermes draft, and (unless dry-run) clicks the final
 * submit. Selectors are best-effort third-party contracts and fail soft.
 */
export async function submitApplication(
  listing: Listing,
  opts: { dryRun?: boolean } = {},
): Promise<SubmitResult> {
  const dryRun = opts.dryRun ?? false;
  const browser = await chromium.launch({ headless: true, args: STEALTH_ARGS });

  try {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    await page.goto(listing.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // Best-effort login for platforms that require it
    await ensureLoggedIn(page, listing.source);

    const message = listing.draft_body || defaultDraft(listing);
    const result = await applyForSource(page, listing, message, dryRun);

    if (dryRun) {
      const screenshotPath = `/app/data/dryrun-${listing.id}.png`;
      await page.screenshot({ path: screenshotPath });
      await context.close();
      return {
        success: true,
        screenshotPath,
        message: "Dry-run: form filled, NOT submitted",
      };
    }

    await context.close();
    return result;
  } catch (err) {
    return {
      success: false,
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await browser.close();
  }
}

function defaultDraft(listing: Listing): string {
  const greeting = ["marktplaats", "roomspot", "pararius", "kamernet"].includes(
    listing.source,
  )
    ? "Beste verhuurder,"
    : "Dear landlord,";
  return `${greeting}\n\nI am very interested in this listing (€${listing.rent}/month). I am a quiet, responsible student at the University of Twente, non-smoker, no pets. I would love to schedule a viewing.`;
}

async function applyForSource(
  page: Page,
  listing: Listing,
  message: string,
  dryRun: boolean,
): Promise<SubmitResult> {
  switch (listing.source) {
    case "kamernet":
      return applyContactForm(page, message, dryRun, {
        openSelectors: [
          "button:has-text('Stuur bericht')",
          "a:has-text('Stuur bericht')",
          "button:has-text('Send message')",
        ],
        textareaSelectors: ["textarea", '[contenteditable="true"]'],
        submitSelectors: [
          "button[type='submit']",
          "button:has-text('Verstuur')",
          "button:has-text('Send')",
        ],
      });
    case "roomspot":
      return applyContactForm(page, message, dryRun, {
        openSelectors: [
          "button:has-text('Contact')",
          "a:has-text('Reageer')",
          "button:has-text('Reageer')",
        ],
        textareaSelectors: ["textarea", '[contenteditable="true"]'],
        submitSelectors: [
          "button[type='submit']",
          "button:has-text('Verstuur')",
          "button:has-text('Send')",
        ],
      });
    case "marktplaats":
      return applyContactForm(page, message, dryRun, {
        openSelectors: [
          "button:has-text('Bericht sturen')",
          "button:has-text('Reageer')",
        ],
        textareaSelectors: ["textarea", '[contenteditable="true"]'],
        submitSelectors: [
          "button[type='submit']",
          "button:has-text('Verstuur')",
          "button:has-text('Verzenden')",
        ],
      });
    case "pararius":
      return applyContactForm(page, message, dryRun, {
        openSelectors: [
          "a:has-text('Contact')",
          "button:has-text('Contact')",
          "a:has-text('Reageren')",
        ],
        textareaSelectors: ["textarea", '[contenteditable="true"]'],
        submitSelectors: [
          "button[type='submit']",
          "button:has-text('Verstuur')",
          "button:has-text('Send')",
        ],
      });
    case "xior":
      return {
        success: false,
        message:
          "Xior uses its own reservation system — manual action required.",
      };
    default:
      return {
        success: false,
        message: `No auto-submit flow for source "${listing.source}".`,
      };
  }
}

interface FormConfig {
  openSelectors: string[];
  textareaSelectors: string[];
  submitSelectors: string[];
}

async function applyContactForm(
  page: Page,
  message: string,
  dryRun: boolean,
  config: FormConfig,
): Promise<SubmitResult> {
  // 1. Open the contact/message UI
  let opened = false;
  for (const sel of config.openSelectors) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) > 0) {
      await btn.click({ timeout: 5000 });
      opened = true;
      await page.waitForTimeout(1500);
      break;
    }
  }
  if (!opened) {
    return {
      success: false,
      message: "Could not find a contact button on this listing.",
    };
  }

  // 2. Fill the message
  let filled = false;
  for (const sel of config.textareaSelectors) {
    const area = page.locator(sel).first();
    if ((await area.count()) > 0) {
      await area.fill(message);
      filled = true;
      break;
    }
  }
  if (!filled) {
    return {
      success: false,
      message: "Could not find a message field on the contact form.",
    };
  }

  // 3. Submit (or stop short in dry-run)
  if (dryRun) {
    return {
      success: true,
      message: "Dry-run: contact form filled, submit skipped.",
    };
  }

  for (const sel of config.submitSelectors) {
    const submit = page.locator(sel).first();
    if ((await submit.count()) > 0) {
      await submit.click({ timeout: 5000 });
      await page.waitForTimeout(2000);
      return { success: true, message: "Application submitted." };
    }
  }

  return {
    success: false,
    message: "Filled the form but could not find the final submit button.",
  };
}
