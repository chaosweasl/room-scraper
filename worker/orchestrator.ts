import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { ensureSchema, ensureSettings, isScraperEnabled } from "./shared/db";
import { recordSourceResult } from "./shared/monitor";
import { startHealthServer } from "./shared/health";
import { triageNewListings } from "./shared/triage";
import { startBot } from "./bot";
import { scrapeKamernet } from "./scraper-kamernet";
import { scrapeMarktplaats } from "./scraper-marktplaats";
import { scrapePararius } from "./scraper-pararius";
import { scrapeRoomspot } from "./scraper-roomspot";
import { checkXiorAvailability } from "./scraper-xior";

chromium.use(stealthPlugin());

interface SourceResult {
  source: string;
  newCount: number;
  error?: string;
}

// Run a single scraper in isolation — one failure must not skip the rest.
async function runOne(
  name: string,
  fn: () => Promise<number>,
): Promise<SourceResult> {
  try {
    const count = await fn();
    console.log(`✅ ${name}: ${count} new listings`);
    recordSourceResult(name, count);
    return { source: name, newCount: count };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ ${name} failed — continuing with next source:`, message);
    recordSourceResult(name, 0, message);
    return { source: name, newCount: 0, error: message };
  }
}

// Only run a source if it is enabled in the settings table.
async function runIfEnabled(
  name: string,
  fn: () => Promise<number>,
  results: SourceResult[],
) {
  if (await isScraperEnabled(name)) {
    results.push(await runOne(name, fn));
  } else {
    console.log(`⏭️ ${name} disabled in settings — skipping`);
  }
}

async function runAllScrapers() {
  console.log("🚀 Starting orchestrated scraping cycle...");
  console.log("=".repeat(50));

  await ensureSchema();
  await ensureSettings();

  // Launch a single stealth browser for all browser-based scrapers
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const results: SourceResult[] = [];

  try {
    // Kamernet is fetch-based and doesn't use the shared browser.
    await runIfEnabled("kamernet", scrapeKamernet, results);
    // Browser-based scrapers run sequentially on the shared instance.
    await runIfEnabled(
      "marktplaats",
      () => scrapeMarktplaats(browser),
      results,
    );
    await runIfEnabled("pararius", () => scrapePararius(browser), results);
    await runIfEnabled("roomspot", () => scrapeRoomspot(browser), results);
    // Xior launches its own (headless-by-default) browser internally.
    await runIfEnabled("xior", () => checkXiorAvailability(browser), results);
  } finally {
    await browser.close();
  }

  // AI triage + commute filter for every newly scraped listing
  try {
    const triageStats = await triageNewListings();
    console.log(
      `🧠 Triage: ${triageStats.drafted} drafted, ${triageStats.auto_rejected} auto-rejected, ${triageStats.new} left new`,
    );
  } catch (err) {
    console.error("❌ Triage pass failed:", err);
  }

  const totalNew = results.reduce((sum, r) => sum + r.newCount, 0);

  console.log("=".repeat(50));
  console.log(`✅ Cycle complete — ${totalNew} total new listings found`);
  for (const r of results) {
    console.log(
      `   ${r.source}: ${r.newCount}${r.error ? ` (error: ${r.error})` : ""}`,
    );
  }
  console.log("=".repeat(50));

  return results;
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
  const finalDelay = BASE_DELAY_MS + randomJitter * modifier;

  console.log(
    `\n⏳ Next scrape scheduled in ${(finalDelay / 60000).toFixed(2)} minutes...`,
  );

  // Schedule the next run
  setTimeout(startEngine, finalDelay);
}

// Start the health endpoint for monitoring
startHealthServer();

// Start the Discord bot (skips gracefully if not configured)
startBot();

// Ignite the engine
startEngine();
