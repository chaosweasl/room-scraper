import { chromium } from 'playwright-extra';
import stealthPlugin from 'puppeteer-extra-plugin-stealth';
import { ensureSchema } from './shared/db';
import { scrapeMarktplaats } from './scraper-marktplaats';
import { scrapePararius } from './scraper-pararius';
import { scrapeRoomspot } from './scraper-roomspot';
import { scrapeKamernet } from './scraper-kamernet';

chromium.use(stealthPlugin());

async function runAllScrapers() {
  console.log('🚀 Starting orchestrated scraping cycle...');
  console.log('='.repeat(50));

  await ensureSchema();

  // Launch a single stealth browser for all scrapers
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  let totalNew = 0;

  try {
    // Run all scrapers sequentially, sharing the browser instance
    totalNew += await scrapeMarktplaats(browser);
    totalNew += await scrapePararius(browser);
    totalNew += await scrapeRoomspot(browser);
    totalNew += await scrapeKamernet(browser);
  } catch (error) {
    console.error('❌ Orchestrator error:', error);
  } finally {
    await browser.close();
  }

  console.log('='.repeat(50));
  console.log(`✅ Cycle complete — ${totalNew} total new listings found`);
  console.log('='.repeat(50));
}

// ---------------------------------------------------------
// THE JITTER ENGINE (Anti-Ban Scheduling)
// ---------------------------------------------------------
const BASE_DELAY_MS = 15 * 60 * 1000; // 15 minutes

async function startEngine() {
  await runAllScrapers();

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