import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { ensureSchema, insertListing } from './shared/db';
import { sendDiscordAlert } from './shared/discord';

// 1. Initialize the database
chromium.use(stealthPlugin());

const SOURCE = 'roomspot';

async function runScraper() {
  console.log("🚀 Starting Roomspot scraping cycle...");

  // Ensure the database schema is up to date
  await ensureSchema();

  // Launch the stealth browser
  const browser = await chromium.launch({ headless: true });

  // Using a context allows us to set a realistic viewport size and user agent
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();

  try {
    // 1. Go to the CORRECT Roomspot URL
    await page.goto('https://www.roomspot.nl/en/housing-offer/to-rent', { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log("✅ Successfully loaded Roomspot.");

    // 2. Nuke the cookie banner so it doesn't intercept future clicks
    try {
      console.log("🍪 Dismissing cookie banner...");
      await page.getByRole('button', { name: 'Deny' }).click({ timeout: 3000 });
    } catch (e) {
      // Ignore if the banner doesn't load or is already gone
    }

    // 3. The graceful timeout and screenshot debugger
    try {
      console.log("👀 Looking for listings in the DOM...");
      await page.waitForSelector('section.list-item', { timeout: 15000 });
    } catch (selectorError) {
      console.log("⚠️ Could not find 'section.list-item'. Taking a screenshot to diagnose...");
      await page.screenshot({ path: '/app/data/error-screenshot.png', fullPage: true });
      console.log("📸 Saved screenshot to your local /data folder as 'error-screenshot.png'.");
      return;
    }

    // 4. Extract the data using the actual Angular classes
    const listings = await page.$$eval('section.list-item', (elements) => {
      return elements.map(el => {
        // Find Address
        const titleEl = el.querySelector('.object-address');
        const address = titleEl ? titleEl.textContent?.trim().replace(/\s+/g, ' ') : 'Unknown Address';

        // Find Property Type (Room, Studio, etc)
        const typeEl = el.querySelector('.woningtype');
        const propertyType = typeEl ? typeEl.textContent?.trim().toLowerCase() : '';

        // Combine them so our backend filter catches the word "studio"
        const title = `${address} - ${propertyType}`;

        // Find the URL
        const linkEl = el.querySelector('a[href]');
        const url = linkEl ? 'https://www.roomspot.nl' + linkEl.getAttribute('href') : '';

        // Find the Price
        const priceEl = el.querySelector('.prijs');
        const rawPrice = priceEl ? priceEl.textContent?.trim() : '0';

        // Clean the price: keep digits, commas, and dots. Then swap comma for dot.
        const cleanPrice = parseFloat(rawPrice.replace(/[^\d.,]/g, '').replace(',', '.'));

        // Find description
        const descEl = el.querySelector('.object-description, .description, [class*="description"]');
        const description = descEl ? descEl.textContent?.trim().substring(0, 500) : '';

        return { id: url, title, url, cleanPrice, propertyType, address, description };
      });
    });

    console.log(`🔍 Found ${listings.length} listings. Analyzing...`);

    // 5. Loop through the extracted data — ACCEPT ALL housing types
    for (const item of listings) {
      console.log(`\nEvaluating: ${item.title}`);
      console.log(`Price: €${item.cleanPrice}`);

      // Determine listing type
      const listingType = item.propertyType || 'unknown';

      // Determine priority — high if under €500 and near campus
      const isHighPriority = item.cleanPrice > 0 && item.cleanPrice <= 500;

      // Save to the SQLite database using the shared insert function
      const result = await insertListing({
        id: item.id,
        title: item.title,
        rent: item.cleanPrice,
        url: item.url,
        source: SOURCE,
        address: item.address,
        listing_type: listingType,
        description: item.description || undefined,
        priority: isHighPriority ? 'high' : 'normal',
      });

      if (result.inserted) {
        console.log(`⭐ NEW: ${item.title} — €${item.cleanPrice} (${listingType})`);

        // Send Discord alert for high-priority listings
        if (isHighPriority) {
          await sendDiscordAlert({
            title: item.title,
            rent: item.cleanPrice,
            url: item.url,
            source: SOURCE,
            address: item.address,
            listing_type: listingType,
            priority: 'high',
          });
        }
      } else {
        console.log(`  Already in DB — skipping`);
      }
    }

    console.log("\n💾 Database updated successfully.");

  } catch (error) {
    console.error("❌ Fatal Scraping Error:", error);
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------
// THE JITTER ENGINE (Anti-Ban Scheduling)
// ---------------------------------------------------------
const BASE_DELAY_MS = 15 * 60 * 1000; // 15 minutes

async function startEngine() {
  await runScraper();

  // Generate a random delay between 0 and 3 minutes
  const randomJitter = Math.floor(Math.random() * (3 * 60 * 1000));

  // Decide whether to add or subtract the jitter
  const modifier = Math.random() > 0.5 ? 1 : -1;
  const finalDelay = BASE_DELAY_MS + (randomJitter * modifier);

  console.log(`\n⏳ Next scrape scheduled in ${(finalDelay / 60000).toFixed(2)} minutes...`);

  // Schedule the next run
  setTimeout(startEngine, finalDelay);
}

// Ignite the engine
startEngine();