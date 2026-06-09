import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { createClient } from '@libsql/client';

// 1. Initialize the SQLite client targeting the shared Docker volume
const db = createClient({
  url: process.env.DATABASE_URL || 'file:/app/data/housing.db',
});

// 2. Register the stealth evasion techniques
chromium.use(stealthPlugin());

// The maximum rent you can pay to still receive Huurtoeslag under 21
const MAX_RENT_THRESHOLD = 498.20;

async function sendDiscordAlert(listing: any) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl || webhookUrl === 'your_discord_webhook_here') return;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `🚨 **NEW VERIFIED STUDIO FOUND!** 🚨\n**Title:** ${listing.title}\n**Bare Rent:** €${listing.cleanPrice}\n**Link:** ${listing.url}`
      })
    });
    console.log("🔔 Discord alert sent!");
  } catch (err) {
    console.error("❌ Failed to send Discord alert:", err);
  }
}

async function runScraper() {
  console.log("🚀 Starting scraping cycle...");
  
  // Ensure the database table exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      title TEXT,
      rent REAL,
      status TEXT,
      url TEXT
    )
  `);

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

        return { id: url, title, url, rawPrice, cleanPrice };
      });
    });

    console.log(`🔍 Found ${listings.length} listings. Analyzing...`);

    // 5. Loop through the extracted data and apply your rules
    for (const item of listings) {
      console.log(`\nEvaluating: ${item.title}`);
      console.log(`Raw Price: ${item.rawPrice} | Parsed: €${item.cleanPrice}`);
      
      let status = 'rejected';
      let isVerified = false;
      
      // Filter 1: Is the base rent under the subsidy threshold?
      if (item.cleanPrice > 0 && item.cleanPrice <= MAX_RENT_THRESHOLD) {
        // Filter 2: Is it actually a studio?
        if (item.title?.toLowerCase().includes('studio')) {
            status = 'verified';
            isVerified = true;
            console.log(`⭐⭐ VERIFIED MATCH: Meets under-21 rent threshold and is a studio!`);
        } else {
            console.log(`❌ Rejected: Rent is good, but it is not labeled as a Studio.`);
        }
      } else {
         console.log(`❌ Rejected: Rent exceeds €${MAX_RENT_THRESHOLD} threshold (or price is missing).`);
      }

      // Check if we already have this exact listing in the database
      const existingRecord = await db.execute({
        sql: "SELECT id FROM listings WHERE id = ?",
        args: [item.id]
      });

      // Save to the SQLite database
      await db.execute({
        sql: "INSERT OR REPLACE INTO listings (id, title, rent, status, url) VALUES (?, ?, ?, ?, ?)",
        args: [item.id, item.title, item.cleanPrice, status, item.url]
      });

      // If it's verified AND it's a completely new listing we've never seen, ping Discord
      if (isVerified && existingRecord.rows.length === 0) {
        await sendDiscordAlert(item);
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