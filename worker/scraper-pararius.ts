import { Browser } from 'playwright';
import { ensureSchema, insertListing } from './shared/db';
import { sendDiscordAlert } from './shared/discord';

const SOURCE = 'pararius';
const SEARCH_URL = 'https://www.pararius.nl/huurwoningen/enschede';

function parsePrice(text: string): number {
  const cleaned = text.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
}

function parseSquareMeters(text: string): number {
  const match = text.match(/(\d+)\s*m²/);
  return match ? parseInt(match[1]) : 0;
}

function detectListingType(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('studio')) return 'studio';
  if (lower.includes('appartement') || lower.includes('apartment')) return 'apartment';
  if (lower.includes('kamer') || lower.includes('room')) return 'room';
  if (lower.includes('woning') || lower.includes('house') || lower.includes('huis')) return 'house';
  return 'unknown';
}

export async function scrapePararius(browser: Browser): Promise<number> {
  console.log('\n🏢 === PARARIUS SCRAPER STARTING ===');
  await ensureSchema();

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  let totalInserted = 0;

  try {
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('✅ Pararius page loaded');

    // Pararius uses Cloudflare — wait for challenge to resolve
    try {
      await page.waitForFunction(() => {
        return !document.title.includes('Just a moment') && !document.querySelector('#challenge-running');
      }, { timeout: 15000 });
      console.log('✅ Cloudflare challenge passed');
    } catch {
      console.log('⚠️ Cloudflare may still be active — trying anyway');
    }

    // Handle cookie consent
    try {
      const cookieBtn = page.locator('button:has-text("Accept"), button:has-text("Accepteren"), button:has-text("Alles accepteren")');
      await cookieBtn.click({ timeout: 3000 });
      console.log('🍪 Cookie banner dismissed');
    } catch {
      // Ignore
    }

    // Wait for listings — Pararius uses SSR, so listings should be in HTML
    const selectors = [
      'section.listing-search-item',
      'li.search-list__item',
      'article.listing-search-item',
      '[class*="listing-search-item"]',
      'div.listing-search-item',
    ];

    let listingElements: any[] = [];
    for (const sel of selectors) {
      try {
        await page.waitForSelector(sel, { timeout: 5000 });
        listingElements = await page.$$(sel);
        if (listingElements.length > 0) {
          console.log(`📋 Found ${listingElements.length} Pararius listings using "${sel}"`);
          break;
        }
      } catch {
        continue;
      }
    }

    if (listingElements.length === 0) {
      // Fallback: try to extract from page content
      console.log('⚠️ No standard listing selectors matched — trying page content extraction');
      const pageText = await page.evaluate(() => document.body.innerText.substring(0, 2000));
      console.log(`  Page text preview: ${pageText.substring(0, 300)}`);
    }

    // Extract listings
    const listings = await page.$$eval('section.listing-search-item, li.search-list__item, article.listing-search-item', (elements) => {
      return elements.map(el => {
        const titleEl = el.querySelector('h2, h3, .listing-search-item__title, [class*="title"]');
        const addressEl = el.querySelector('.listing-search-item__sub-title, [class*="address"], [class*="sub-title"]');
        const priceEl = el.querySelector('.listing-search-item__price, [class*="price"]');
        const areaEl = el.querySelector('.listing-search-item__surface-area, [class*="surface"], [class*="area"]');
        const linkEl = el.querySelector('a[href]');

        const title = titleEl?.textContent?.trim() || 'Unknown';
        const address = addressEl?.textContent?.trim() || '';
        const priceText = priceEl?.textContent?.trim() || '';
        const areaText = areaEl?.textContent?.trim() || '';
        const relUrl = linkEl?.getAttribute('href') || '';
        const url = relUrl ? (relUrl.startsWith('http') ? relUrl : 'https://www.pararius.nl' + relUrl) : '';

        return { title, address, priceText, areaText, url };
      });
    });

    console.log(`📋 Extracted ${listings.length} Pararius listings`);

    for (const item of listings) {
      if (!item.url) continue;

      const rent = parsePrice(item.priceText);
      const sqm = parseSquareMeters(item.areaText);
      const listingType = detectListingType(item.title + ' ' + item.address);

      const result = await insertListing({
        id: `pr-${Buffer.from(item.url).toString('base64').substring(0, 32)}`,
        title: item.title,
        rent,
        url: item.url,
        source: SOURCE,
        address: item.address || 'Enschede',
        listing_type: listingType,
        description: item.areaText ? `${item.areaText} | ${item.address}` : item.address,
        priority: rent > 0 && rent <= 500 ? 'high' : 'normal',
      });

      if (result.inserted) {
        totalInserted++;
        console.log(`  ➕ NEW: ${item.title} — €${rent} — ${sqm}m²`);

        if (rent > 0 && rent <= 500) {
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
    console.error('❌ Pararius scraper error:', error);
  } finally {
    await context.close();
  }

  console.log(`🏢 Pararius done — ${totalInserted} new listings inserted
`);
  return totalInserted;
}