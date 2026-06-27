import { Browser } from 'playwright';
import { insertListing } from './shared/db';
import { sendDiscordAlert } from './shared/discord';

const SOURCE = 'roomspot';

export async function scrapeRoomspot(browser: Browser): Promise<number> {
  console.log('🏠 Starting Roomspot scraper...');

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  let newCount = 0;

  try {
    await page.goto('https://www.roomspot.nl/en/housing-offer/to-rent', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    console.log('✅ Roomspot loaded.');

    // Dismiss cookie banner
    try {
      await page.getByRole('button', { name: 'Deny' }).click({ timeout: 3000 });
    } catch {
      // ignore
    }

    // Wait for listings
    try {
      await page.waitForSelector('section.list-item', { timeout: 15000 });
    } catch {
      console.log('⚠️ No roomspot listings found.');
      await page.screenshot({ path: '/app/data/roomspot-error.png', fullPage: true });
      return 0;
    }

    const listings = await page.$$eval('section.list-item', (elements) =>
      elements.map((el) => {
        const titleEl = el.querySelector('.object-address');
        const address = titleEl
          ? titleEl.textContent?.trim().replace(/\s+/g, ' ')
          : 'Unknown Address';
        const typeEl = el.querySelector('.woningtype');
        const propertyType = typeEl ? typeEl.textContent?.trim().toLowerCase() : '';
        const title = `${address} - ${propertyType}`;
        const linkEl = el.querySelector('a[href]');
        const url = linkEl
          ? 'https://www.roomspot.nl' + linkEl.getAttribute('href')
          : '';
        const priceEl = el.querySelector('.prijs');
        const rawPrice = priceEl ? priceEl.textContent?.trim() : '0';
        const cleanPrice = parseFloat(
          rawPrice.replace(/[^\d.,]/g, '').replace(',', '.')
        );
        return { id: url, title, url, cleanPrice };
      })
    );

    console.log(`🔍 Roomspot: ${listings.length} total listings found.`);

    for (const item of listings) {
      const result = await insertListing({
        id: item.id,
        title: item.title,
        rent: item.cleanPrice,
        url: item.url,
        source: SOURCE,
        address: item.title,
        listing_type: item.title.toLowerCase().includes('studio')
          ? 'studio'
          : 'room',
        priority: item.cleanPrice <= 500 ? 'high' : 'normal',
      });

      if (result.inserted) {
        newCount++;
        // Discord alert for cheap listings near campus
        if (item.cleanPrice <= 500) {
          await sendDiscordAlert({
            title: item.title,
            rent: item.cleanPrice,
            url: item.url,
            source: SOURCE,
            listing_type: item.title.toLowerCase().includes('studio') ? 'studio' : 'room',
            priority: 'high',
          });
        }
      }
    }

    console.log(`✅ Roomspot: ${newCount} new listings added.`);
    return newCount;
  } catch (error) {
    console.error('❌ Roomspot scraper error:', error);
    return 0;
  } finally {
    await page.close();
    await context.close();
  }
}
