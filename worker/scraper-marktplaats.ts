import { Browser } from 'playwright';
import { ensureSchema, insertListing } from './shared/db';
import { sendDiscordAlert } from './shared/discord';

const SOURCE = 'marktplaats';
const SEARCH_URL = 'https://www.marktplaats.nl/l/huizen-en-kamers/kamers-te-huur/#q:enschede';

function parsePrice(text: string): number {
  // "€ 730,00" → 730
  // "€ 1.234,56" → 1234.56
  const cleaned = text.replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(cleaned) || 0;
}

function detectListingType(title: string, description: string): string {
  const combined = (title + ' ' + description).toLowerCase();
  if (combined.includes('studio')) return 'studio';
  if (combined.includes('appartement') || combined.includes('apartment')) return 'apartment';
  if (combined.includes('kamer') || combined.includes('room')) return 'room';
  if (combined.includes('woning') || combined.includes('house')) return 'house';
  return 'unknown';
}

export async function scrapeMarktplaats(browser: Browser): Promise<number> {
  console.log('\n🏠 === MARKTPLAATS SCRAPER STARTING ===');
  await ensureSchema();

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  let totalInserted = 0;

  try {
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('✅ Marktplaats loaded');

    // Handle cookie banner
    try {
      const cookieBtn = page.locator('button:has-text("Accepteren"), button:has-text("Alles accepteren"), button:has-text("Accepteren en doorgaan")');
      await cookieBtn.click({ timeout: 3000 });
      console.log('🍪 Cookie banner dismissed');
    } catch {
      // No cookie banner or already accepted
    }

    // Wait for listings to load
    try {
      await page.waitForSelector('li.hz-Listing', { timeout: 15000 });
    } catch {
      console.log('⚠️ No Marktplaats listings found — page may have changed');
      return 0;
    }

    // Scroll a bit to trigger lazy loading
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(1000);

    // Extract listings from current page
    const listings = await page.$$eval('li.hz-Listing', (elements) => {
      return elements.map(el => {
        // Link
        const linkEl = el.querySelector('a[href*="/v/"]');
        const relUrl = linkEl?.getAttribute('href') || '';
        const url = relUrl ? 'https://www.marktplaats.nl' + relUrl : '';

        // Title and description area — split by newlines BEFORE collapsing whitespace
        const descArea = el.querySelector('[class*="title-description"]');
        const rawText = descArea?.textContent?.trim() || '';
        // Split on newlines first, then clean each line
        const rawLines = rawText.split('\n').map(l => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
        const title = rawLines[0] || 'Unknown';

        // Price area
        const priceArea = el.querySelector('[class*="price-date"]');
        const priceText = priceArea?.textContent?.trim() || '';
        const priceLine = priceText.split('\n')[0] || '';

        // Extract location from title or description
        const locationMatch = title.match(/in\s+(\w+)/i);
        const location = locationMatch ? locationMatch[1] : 'Enschede';

        // Description snippet (everything after title)
        const description = rawLines.slice(1).join(' ').substring(0, 500);

        return { title, priceText: priceLine, url, location, description };
      });
    });

    console.log(`📋 Found ${listings.length} Marktplaats listings`);

    for (const item of listings) {
      if (!item.url) continue;
      // Skip huurwoningen.nl syndicated listings (they redirect to a paywall)
      if (item.url.includes('?c=')) {
        console.log(`  ⏭️ Skipping huurwoningen redirect: ${item.title.substring(0, 60)}`);
        continue;
      }

      const rent = parsePrice(item.priceText);
      const listingType = detectListingType(item.title, item.description);

      // Extract real Marktplaats ID from URL: /a123456789 or /m123456789
      const idMatch = item.url.match(/\/([am]\d{8,})/);
      const listingId = idMatch ? idMatch[1] : `r-${Math.random().toString(36).substring(2, 10)}`;
      const result = await insertListing({
        id: `mp-${listingId}`,
        title: item.title,
        rent,
        url: item.url,
        source: SOURCE,
        address: item.location,
        listing_type: listingType,
        description: item.description || undefined,
        priority: 'normal',
      });

      if (result.inserted) {
        totalInserted++;
        console.log(`  ➕ NEW: ${item.title} — €${rent}`);

        // Alert for good deals under €500
        if (rent > 0 && rent <= 500) {
          await sendDiscordAlert({
            title: item.title,
            rent,
            url: item.url,
            source: SOURCE,
            address: item.location,
            listing_type: listingType,
            priority: 'high',
          });
        }
      }
    }

    // Try pagination — check for next page
    try {
      const nextPageLink = await page.$('a.hz-PaginationLink[aria-label*="Pagina"]');
      if (nextPageLink) {
        console.log('📄 Pagination detected — would fetch next page in production');
        // In production, we'd loop through pages here
      }
    } catch {
      // No pagination
    }

  } catch (error) {
    console.error('❌ Marktplaats scraper error:', error);
  } finally {
    await context.close();
  }

  console.log(`🏠 Marktplaats done — ${totalInserted} new listings inserted
`);
  return totalInserted;
}
