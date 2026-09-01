import { Browser } from "playwright";
import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";
import { insertListing } from "./shared/db";
import { sendDiscordAlert } from "./shared/discord";
import { hashUrl } from "./shared/hash";

chromium.use(stealthPlugin());

const SOURCE = "xior";
const ARIENSPLEIN_URL =
  "https://www.xiorstudenthousing.eu/netherlands/enschede/ariensplein-student-accommodation/";
const ROOM_TYPES = ["Comfy", "Comfy (balcony)"];

const NO_ROOM_PHRASES = [
  "no room available",
  "no availability",
  "uitverkocht",
  "niet beschikbaar",
  "no results",
  "sold out",
];

export async function checkXiorAvailability(
  _sharedBrowser: Browser,
): Promise<number> {
  console.log("\n🏘️ === XIOR AVAILABILITY CHECKER STARTING ===");

  // Xior launches its own browser (Cloudflare needs a full fingerprint).
  const browser = await chromium.launch({
    headless: process.env.XIOR_HEADLESS !== "false",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-GB",
  });

  const page = await context.newPage();
  let newCount = 0;

  try {
    console.log("📍 Loading Ariensplein page...");
    await page.goto(ARIENSPLEIN_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    console.log("✅ Ariensplein page loaded");
    await page.waitForTimeout(2500);

    // Find and click "Book a room".
    const bookBtn = page
      .locator("a, button")
      .filter({ hasText: /book.*room|reserveer|boek|book now|apply/i })
      .first();
    if ((await bookBtn.count()) === 0) {
      console.log('⚠️ No "Book a room" button found');
      return 0;
    }
    await bookBtn.scrollIntoViewIfNeeded();
    await bookBtn.click({ timeout: 5000 }).catch(() => undefined);
    console.log('✅ Clicked "Book a room"');
    await page.waitForTimeout(3000);

    for (const roomType of ROOM_TYPES) {
      console.log(`🔍 Checking: "${roomType}"...`);
      const roomOption = page
        .locator('label, button, div[role="button"], a, span')
        .filter({ hasText: roomType })
        .first();
      if ((await roomOption.count()) === 0) {
        console.log(`⚠️ Room type "${roomType}" not found`);
        continue;
      }

      await roomOption.scrollIntoViewIfNeeded();
      await roomOption.click({ timeout: 5000 }).catch(() => undefined);
      console.log(`✅ Selected "${roomType}"`);
      await page.waitForTimeout(1500);

      const nextBtn = page
        .locator('a, button, input[type="submit"]')
        .filter({ hasText: /next|volgende|continue|verder/i })
        .first();
      if ((await nextBtn.count()) > 0) {
        await nextBtn.scrollIntoViewIfNeeded();
        await nextBtn.click({ timeout: 5000 }).catch(() => undefined);
        console.log("✅ Clicked Next");
        await page.waitForTimeout(3000);
      }

      const pageText = (await page.textContent("body")) || "";
      const isUnavailable = NO_ROOM_PHRASES.some((phrase) =>
        pageText.toLowerCase().includes(phrase),
      );

      if (isUnavailable) {
        console.log(`❌ ${roomType}: No rooms available`);
        continue;
      }

      console.log(`🎉 ${roomType}: ROOM AVAILABLE!`);
      const title = `Xior Ariensplein — ${roomType}`;
      const url = `${ARIENSPLEIN_URL}${roomType.replace(/\s+/g, "-").toLowerCase()}`;

      const result = await insertListing({
        id: hashUrl(url),
        title,
        rent: 0,
        url: ARIENSPLEIN_URL,
        source: SOURCE,
        address: "Ariensplein, Enschede",
        listing_type: "studio",
        description: `Xior Ariensplein availability check found "${roomType}". First-come, first-served — act fast.`,
        priority: "high",
      });

      if (result.inserted) {
        newCount++;
        await sendDiscordAlert({
          title: `🚨 XIOR ARIENSPLEIN — ${roomType} AVAILABLE!`,
          rent: 0,
          url: ARIENSPLEIN_URL,
          source: SOURCE,
          address: "Ariensplein, Enschede",
          listing_type: "studio",
          priority: "high",
        });
        console.log("🔔 Discord alert sent!");
      }
    }

    if (newCount === 0) console.log("📭 No Xior rooms available this cycle");
  } catch (error) {
    console.error("❌ Xior availability checker error:", error);
  } finally {
    await browser.close();
  }

  return newCount;
}
