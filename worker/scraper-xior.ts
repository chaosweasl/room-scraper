import { Browser } from 'playwright';
import { ensureSchema, insertListing } from './shared/db';
import { sendDiscordAlert } from './shared/discord';

const SOURCE = 'xior';
// Xior redirects to xiorstudenthousing.eu — try multiple URL patterns
const SEARCH_URLS = [
  'https://www.xior.nl/en/student-rooms/enschede/',
  'https://www.xiorstudenthousing.eu/en/search?city=Enschede',
  'https://www.xior.nl/en/search?city=Enschede',
];

function parsePrice(text: string): number {
  const cleaned = text.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  return Math.round((parseFloat(cleaned) || 0) * 100) / 100;
}

function detectListingType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('studio')) return 'studio';
  if (lower.includes('apartment') || lower.includes('appartement')) return 'apartment';
  if (lower.includes('room') || lower.includes('kamer')) return 'room';
  return 'unknown';
}

export async function scrapeXior(browser: Browser): Promise<number> {
  console.log('\n🏘️ === XIOR SCRAPER STARTING ===');
  await ensureSchema();

  let totalInserted = 0;

  for (const url of SEARCH_URLS) {
    if (totalInserted > 0) break; // Stop if we got data from a previous URL

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    try {
      console.log(`  Trying URL: ${url}`);
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

      if (!response || response.status() === 403) {
        console.log(`  ⚠️ 403 Forbidden for ${url} — trying next URL`);
        await context.close();
        continue;
      }

      console.log(`✅ Xior page loaded (${response.status()})`);

      // Handle cookie consent
      try {
        const cookieBtn = page.locator('button:has-text("Accept"), button:has-text("Accepteren"), button:has-text("All cookies"), button:has-text("Accept all")');
        await cookieBtn.click({ timeout: 3000 });
        console.log('🍪 Cookie banner dismissed');
      } catch {
        // Ignore
      }

      // Wait for listings
      const selectors = [
        '.property-card',
        '.room-card',
        '[class*="property"]',
        '[class*="listing"]',
        '[class*="room"]',
        'article',
        '.card',
        '.residence-card',
      ];

      let listingElements: any[] = [];
      for (const sel of selectors) {
        try {
          await page.waitForSelector(sel, { timeout: 5000 });
          listingElements = await page.$$(sel);
          if (listingElements.length > 0) {
            console.log(`📋 Found ${listingElements.length} Xior elements using "${sel}"`);
            break;
          }
        } catch {
          continue;
        }
      }

      if (listingElements.length === 0) {
        // Try to extract from page content
        const pageText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
        console.log(`  Page text preview: ${pageText.substring(0, 300)}`);

        // If page has "Enschede" and prices, try extracting manually
        if (pageText.toLowerCase().includes('enschede')) {
          console.log('  Page contains Enschede content — attempting manual extraction');
        }
      }

      // Try common Xior selectors
      const listings = await page.$$eval(
        '.property-card, .room-card, [class*="property"], [class*="room-item"], article, .card, .residence-card',
        (elements) => {
          return elements.filter(el => {
            // Filter to only elements that look like listings
            const text = el.textContent?.toLowerCase() || '';
            return text.includes('€') || text.includes('enschede') || text.includes('room') || text.includes('studio');
          }).map(el => {
            const titleEl = el.querySelector('h2, h3, h4, [class*="title"], [class*="name"]');
            const priceEl = el.querySelector('[class*="price"], span:has(> text:contains("€"))');
            const addressEl = el.querySelector('[class*="location"], [class*="address"], [class*="city"]');
            const linkEl = el.querySelector('a[href]');
            const dateEl = el.querySelector('[class*="available"], [class*="date"]');

            const title = titleEl?.textContent?.trim() || el.textContent?.split('\n')[0]?.trim() || 'Unknown';
            const priceText = priceEl?.textContent?.trim() || '';
            const address = addressEl?.textContent?.trim() || 'Enschede';
            const availability = dateEl?.textContent?.trim() || '';
            const relUrl = linkEl?.getAttribute('href') || '';
            const url = relUrl ? (relUrl.startsWith('http') ? relUrl : 'https://www.xior.nl' + relUrl) : '';

            return { title, priceText, address, url, availability };
          });
        }
      );

      console.log(`📋 Extracted ${listings.length} Xior listings`);

      for (const item of listings) {
        if (!item.url) continue;

        const rent = parsePrice(item.priceText);
        const listingType = detectListingType(item.title);

        const result = await insertListing({
          id: `xr-${Buffer.from(item.url).toString('base64').substring(0, 32)}`,
          title: item.title,
          rent,
          url: item.url,
          source: SOURCE,
          address: item.address,
          listing_type: listingType,
          description: item.availability ? `Available: ${item.availability}` : undefined,
          priority: 'high', // Xior is always high priority — first-come-first-served!
        });

        if (result.inserted) {
          totalInserted++;
          console.log(`  ➕ NEW (HIGH PRIORITY): ${item.title} — €${rent}`);

          // ALWAYS send Discord alert for Xior — it's urgent!
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

    } catch (error) {
      console.error(`❌ Xior scraper error for ${url}:`, error);
    } finally {
      await context.close();
    }
  }

  console.log(`🏘️ Xior done — ${totalInserted} new listings inserted
`);
  return totalInserted;
}