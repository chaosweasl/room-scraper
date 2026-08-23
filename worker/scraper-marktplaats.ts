import { Browser, Page } from "playwright";
import { ensureSchema, insertListing } from "./shared/db";
import { sendDiscordAlert } from "./shared/discord";
import { hashUrl } from "./shared/hash";

const SOURCE = "marktplaats";
const SEARCH_URL =
  "https://www.marktplaats.nl/l/huizen-en-kamers/kamers-te-huur/#q:enschede";
const MAX_PAGES = Number(process.env.MARKTPLAATS_MAX_PAGES || "5");

function parsePrice(text: string): number {
  // "€ 730,00" → 730
  // "€ 1.234,56" → 1234.56
  const cleaned = text
    .replace(/[€\s]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  return Math.round((parseFloat(cleaned) || 0) * 100) / 100;
}

function detectListingType(title: string, description: string): string {
  const combined = (title + " " + description).toLowerCase();
  if (combined.includes("studio")) return "studio";
  if (combined.includes("appartement") || combined.includes("apartment"))
    return "apartment";
  if (combined.includes("kamer") || combined.includes("room")) return "room";
  if (combined.includes("woning") || combined.includes("house")) return "house";
  return "unknown";
}

interface MarktplaatsItem {
  title: string;
  priceText: string;
  url: string;
  rawUrl: string;
  location: string;
  description: string;
}

async function extractListings(page: Page): Promise<MarktplaatsItem[]> {
  return await page.$$eval("li.hz-Listing", (elements) => {
    return elements.map((el) => {
      // Link
      const linkEl = el.querySelector('a[href*="/v/"]');
      const relUrl = linkEl?.getAttribute("href") || "";
      // Keep the raw (unstripped) URL so we can detect huurwoningen redirects later
      const rawUrl = relUrl;
      let url = relUrl ? "https://www.marktplaats.nl" + relUrl : "";
      // Strip tracking params from URLs
      url = url
        .replace(/[?&]c=[^&]+/, "")
        .replace(/[?&]casData=[^&]+/, "")
        .replace(/\?$/, "");

      // Title and description area — split by newlines BEFORE collapsing whitespace
      const descArea = el.querySelector('[class*="title-description"]');
      const rawText = descArea?.textContent?.trim() || "";
      // Split on newlines first, then clean each line
      const rawLines = rawText
        .split("\n")
        .map((l) => l.trim().replace(/\s+/g, " "))
        .filter(Boolean);
      let title = rawLines[0] || "Unknown";
      // If title is too long (description merged in), truncate at first period or comma
      if (title.length > 80) {
        const periodIdx = title.indexOf(".");
        const commaIdx = title.indexOf(",");
        const cutIdx = periodIdx > 0 ? periodIdx : commaIdx > 0 ? commaIdx : 80;
        title = title.substring(0, cutIdx).trim();
      }

      // Price area
      const priceArea = el.querySelector('[class*="price-date"]');
      const priceText = priceArea?.textContent?.trim() || "";
      const priceLine = priceText.split("\n")[0] || "";

      // Extract location — try address element first, then title patterns
      let location = "";
      const addrEl = el.querySelector(
        '[class*="location"], [class*="address"], [class*="city"]',
      );
      if (addrEl) {
        location = addrEl.textContent?.trim().split(",")[0] || "";
      }
      if (!location) {
        // Try "in CityName" pattern from title
        const locMatch = title.match(
          /\bin\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/,
        );
        location = locMatch ? locMatch[1] : "";
      }
      if (!location) {
        // Fallback: check for city names in description
        for (const city of [
          "Enschede",
          "Hengelo",
          "Gronau",
          "Oldenzaal",
          "Almelo",
        ]) {
          if (title.toLowerCase().includes(city.toLowerCase())) {
            location = city;
            break;
          }
        }
      }
      if (!location) location = "Enschede";

      // Description snippet (everything after title)
      const description = rawLines.slice(1).join(" ").substring(0, 500);

      return {
        title,
        priceText: priceLine,
        url,
        rawUrl,
        location,
        description,
      };
    });
  });
}

export async function scrapeMarktplaats(browser: Browser): Promise<number> {
  console.log("\n🏠 === MARKTPLAATS SCRAPER STARTING ===");
  await ensureSchema();

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  let totalInserted = 0;

  try {
    await page.goto(SEARCH_URL, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    console.log("✅ Marktplaats loaded");

    // Handle cookie banner
    try {
      const cookieBtn = page.locator(
        'button:has-text("Accepteren"), button:has-text("Alles accepteren"), button:has-text("Accepteren en doorgaan")',
      );
      await cookieBtn.click({ timeout: 3000 });
      console.log("🍪 Cookie banner dismissed");
    } catch {
      // No cookie banner or already accepted
    }

    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      // Wait for listings to load
      try {
        await page.waitForSelector("li.hz-Listing", { timeout: 15000 });
      } catch {
        if (pageNum === 1) {
          console.log(
            "⚠️ No Marktplaats listings found — page may have changed",
          );
        }
        break;
      }

      // Scroll a bit to trigger lazy loading
      await page.evaluate(() => window.scrollBy(0, 2000));
      await page.waitForTimeout(1000);

      const listings = await extractListings(page);
      console.log(
        `📋 Page ${pageNum}: found ${listings.length} Marktplaats listings`,
      );

      for (const item of listings) {
        if (!item.url) continue;
        // Skip huurwoningen.nl syndicated listings (they redirect to a paywall).
        // Check the RAW url — the params are stripped from `item.url` above.
        if (item.rawUrl.includes("?c=") && item.rawUrl.includes("casData=")) {
          console.log(
            `  ⏭️ Skipping huurwoningen redirect: ${item.title.substring(0, 60)}`,
          );
          continue;
        }
        // Skip auto-generated junk titles from huurwoningen syndication
        if (
          /^(Kamer|Studio|Huis|Appartement)\s+in\s+\w+\s+gevonden\s+voor/i.test(
            item.title,
          )
        ) {
          console.log(
            `  ⏭️ Skipping junk syndicated listing: ${item.title.substring(0, 60)}`,
          );
          continue;
        }

        const rent = parsePrice(item.priceText);
        const listingType = detectListingType(item.title, item.description);

        // Fix address: if address is just "ons" or other junk, use title to extract
        let address = item.location;
        if (!address || address.length < 3 || address === "ons") {
          const addrMatch = item.title.match(
            /^([A-Z][a-zæøå]+(?:\s+[A-Z][a-zæøå]+){0,3})/,
          );
          address = addrMatch
            ? addrMatch[0].replace(/\s*[-–]\s*$/, "").trim()
            : "Enschede";
        }

        const result = await insertListing({
          id: hashUrl(item.url),
          title: item.title,
          rent,
          url: item.url,
          source: SOURCE,
          address: address,
          listing_type: listingType,
          description: item.description || undefined,
          priority: "normal",
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
              priority: "high",
            });
          }
        }
      }

      // Pagination — click the "next page" control if present (SPA routing).
      const nextLink = page
        .locator(
          'a[aria-label*="Volgende"], a.hz-PaginationLink[aria-label*="Volgende"]',
        )
        .first();
      if ((await nextLink.count()) === 0) break;

      await nextLink.click();
      await page.waitForTimeout(2000);
    }
  } catch (error) {
    console.error("❌ Marktplaats scraper error:", error);
  } finally {
    await context.close();
  }

  console.log(`🏠 Marktplaats done — ${totalInserted} new listings inserted`);
  return totalInserted;
}
