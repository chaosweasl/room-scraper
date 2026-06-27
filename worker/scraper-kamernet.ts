import { Browser } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { ensureSchema, insertListing } from './shared/db';
import { sendDiscordAlert } from './shared/discord';

const SOURCE = 'kamernet';
const COOKIE_PATH = '/app/data/kamernet-session.json';
const LOGIN_URL = 'https://kamernet.nl/en/login';
const SEARCH_URLS = [
  'https://kamernet.nl/en/rooms/netherlands/enschede?maxRent=600',
  'https://kamernet.nl/en/rooms?city=Enschede&maxPrice=600',
  'https://kamernet.nl/en/rooms/enschede?maxRent=600',
];

function parsePrice(text: string): number {
  // "€ 450,00" → 450, "€ 1.234,56" → 1234.56
  const cleaned = text.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
}

function detectListingType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('studio')) return 'studio';
  if (lower.includes('appartement') || lower.includes('apartment')) return 'apartment';
  if (lower.includes('room') || lower.includes('kamer')) return 'room';
  return 'unknown';
}

function generateId(url: string): string {
  return `km-${Buffer.from(url).toString('base64').substring(0, 32)}`;
}

async function loadCookies(context: any): Promise<boolean> {
  try {
    if (fs.existsSync(COOKIE_PATH)) {
      const raw = fs.readFileSync(COOKIE_PATH, 'utf-8');
      const cookies = JSON.parse(raw);
      if (Array.isArray(cookies) && cookies.length > 0) {
        await context.addCookies(cookies);
        console.log('🍪 Loaded saved Kamernet session cookies');
        return true;
      }
    }
  } catch (err: any) {
    console.log('⚠️ Could not load cookies:', err.message);
  }
  return false;
}

async function saveCookies(context: any): Promise<void> {
  try {
    const dir = path.dirname(COOKIE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const cookies = await context.cookies();
    fs.writeFileSync(COOKIE_PATH, JSON.stringify(cookies, null, 2));
    console.log('💾 Saved Kamernet session cookies');
  } catch (err: any) {
    console.log('⚠️ Could not save cookies:', err.message);
  }
}

async function performLogin(page: any): Promise<boolean> {
  const email = process.env.KAMERNET_EMAIL;
  const password = process.env.KAMERNET_PASSWORD;

  if (!email || !password || email.includes('your_kamernet')) {
    console.log('⚠️ Kamernet credentials not configured — browsing without login');
    return false;
  }

  console.log('🔑 Logging into Kamernet...');

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Handle cookie consent banner first
  try {
    const cookieBtn = page.locator(
      'button:has-text("Accept"), button:has-text("Accepteren"), button:has-text("Alles accepteren"), button:has-text("Akkoord")'
    );
    await cookieBtn.click({ timeout: 3000 });
    await page.waitForTimeout(500);
  } catch {
    // ignore
  }

  // Wait for and fill login form
  try {
    await page.waitForSelector(
      'input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="e-mail" i]',
      { timeout: 10000 }
    );
  } catch {
    console.log('⚠️ Login form not found');
    return false;
  }

  // Fill email
  await page.fill(
    'input[type="email"], input[name="email"], input[placeholder*="email" i], input[placeholder*="e-mail" i]',
    email
  );
  // Fill password
  await page.fill('input[type="password"], input[name="password"]', password);

  // Click submit
  await page.click(
    'button[type="submit"], button:has-text("Log in"), button:has-text("Login"), button:has-text("Inloggen"), button:has-text("Sign in")'
  );

  // Wait for post-login navigation
  try {
    await page.waitForURL('**/kamernet.nl/**', { timeout: 15000 });
    await page.waitForTimeout(3000);
  } catch {
    console.log('⚠️ Login navigation timed out — checking if still logged in');
  }

  // Verify login success
  const isLoggedIn =
    (await page.locator(
      '[class*="user-menu"], [class*="profile"], [class*="dashboard"], [class*="avatar"], [data-testid="user-menu"], [class*="logged-in"]'
    ).count()) > 0;

  // Also check that we no longer see the login form
  const stillOnLogin =
    (await page.locator('input[type="email"], input[name="email"]').count()) === 0;

  if (isLoggedIn || stillOnLogin) {
    console.log('✅ Kamernet login successful');
    return true;
  }

  console.log('⚠️ Could not verify Kamernet login — proceeding anyway');
  return true;
}

export async function scrapeKamernet(browser: Browser): Promise<number> {
  console.log('\n🏠 === KAMERNET SCRAPER STARTING ===');
  await ensureSchema();

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  let totalInserted = 0;

  try {
    // ── 1. Authenticate (load cached cookies or perform fresh login) ──
    const hasCookies = await loadCookies(context);

    if (hasCookies) {
      // Verify cookies are still valid by visiting a protected page
      await page.goto('https://kamernet.nl/en/dashboard', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForTimeout(2000);

      // If we land back on the login form, the session expired
      const needsLogin =
        (await page.locator('input[type="email"], input[name="email"]').count()) > 0;

      if (needsLogin) {
        console.log('⚠️ Saved session expired — re-logging in');
        const loggedIn = await performLogin(page);
        if (loggedIn) await saveCookies(context);
      } else {
        console.log('✅ Session cookies still valid');
      }
    } else {
      // No cached cookies — fresh login
      const loggedIn = await performLogin(page);
      if (loggedIn) await saveCookies(context);
    }

    // ── 2. Search for listings ──
    let listings: any[] = [];

    for (const searchUrl of SEARCH_URLS) {
      if (listings.length > 0) break;

      console.log(`  Trying search: ${searchUrl}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Give React/AJAX time to render listing cards
      await page.waitForTimeout(3000);

      // Dismiss any cookie / consent banner that may appear on search page
      try {
        const cookieBtn = page.locator(
          'button:has-text("Accept"), button:has-text("Accepteren"), button:has-text("Akkoord")'
        );
        await cookieBtn.click({ timeout: 3000 });
        await page.waitForTimeout(500);
      } catch {
        // ignore
      }

      // Try multiple selectors to find listing cards
      const cardSelectors = [
        '[class*="room-card"]',
        '[class*="listing-card"]',
        '[class*="search-result"]',
        '[class*="property-card"]',
        '[class*="RoomCard"]',
        '[class*="ListingTile"]',
        '[data-testid*="listing"]',
        'article',
        'a[href*="/rooms/"][href*="/enschede"]',
      ];

      for (const sel of cardSelectors) {
        try {
          await page.waitForSelector(sel, { timeout: 5000 });
          const count = await page.locator(sel).count();
          if (count > 0) {
            console.log(`📋 Found ${count} Kamernet elements using "${sel}"`);

            listings = await page.$$eval(sel, (elements) => {
              return elements.map((el) => {
                const titleEl = el.querySelector(
                  'h2, h3, h4, [class*="title"], [class*="name"]'
                );
                const priceEl = el.querySelector(
                  '[class*="price"], span:has-text("€"), [class*="rent"]'
                );
                const addressEl = el.querySelector(
                  '[class*="address"], [class*="location"], [class*="city"], [class*="street"]'
                );
                // If the matched element is itself an <a>, use it directly
                const linkEl =
                  el.tagName === 'A' ? el : el.querySelector('a[href]');
                const descEl = el.querySelector(
                  '[class*="description"], [class*="info"], p'
                );
                const dateEl = el.querySelector(
                  '[class*="available"], [class*="date"], [class*="from"]'
                );

                const title =
                  titleEl?.textContent?.trim() ||
                  el.textContent?.split('\n')[0]?.trim() ||
                  'Unknown';
                const priceText = priceEl?.textContent?.trim() || '';
                const address = addressEl?.textContent?.trim() || 'Enschede';
                const relUrl = linkEl?.getAttribute('href') || '';
                const url = relUrl
                  ? relUrl.startsWith('http')
                    ? relUrl
                    : 'https://kamernet.nl' + relUrl
                  : '';
                const description =
                  descEl?.textContent?.trim()?.substring(0, 500) || '';
                const availableDate = dateEl?.textContent?.trim() || '';

                return { title, priceText, address, url, description, availableDate };
              });
            });

            if (listings.length > 0) break; // stop trying selectors
          }
        } catch {
          continue;
        }
      }
    }

    console.log(`📋 Extracted ${listings.length} Kamernet listings`);

    // ── 3. Process each listing ──
    for (const item of listings) {
      if (!item.url) continue;

      const rent = parsePrice(item.priceText);
      const listingType = detectListingType(item.title + ' ' + item.description);
      const priority = rent > 0 && rent <= 500 ? 'high' : 'normal';

      const description = item.availableDate
        ? `Available: ${item.availableDate} | ${item.description}`
        : item.description || undefined;

      const result = await insertListing({
        id: generateId(item.url),
        title: item.title,
        rent,
        url: item.url,
        source: SOURCE,
        address: item.address,
        listing_type: listingType,
        description,
        priority,
      });

      if (result.inserted) {
        totalInserted++;
        console.log(
          `  ➕ NEW${priority === 'high' ? ' (HIGH PRIORITY)' : ''}: ${item.title} — €${rent}`
        );

        // Discord alert for high-priority (under €500)
        if (priority === 'high') {
          await sendDiscordAlert({
            title: item.title,
            rent,
            url: item.url,
            source: SOURCE,
            address: item.address,
            listing_type: listingType,
            priority: 'high',
          });
        }
      }
    }
  } catch (error) {
    console.error('❌ Kamernet scraper error:', error);
  } finally {
    await context.close();
  }

  console.log(`🏠 Kamernet done — ${totalInserted} new listings inserted`);
  return totalInserted;
}