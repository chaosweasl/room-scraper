import { Browser, BrowserContext, Page } from "playwright";
import { db, insertListing } from "./shared/db";
import { sendDiscordAlert } from "./shared/discord";
import { hashUrl } from "./shared/hash";
import { ensureLoggedIn } from "./shared/auth";

const SOURCE = "roomspot";
const LISTING_URL = "https://www.roomspot.nl/en/housing-offer/to-rent";
const MAX_PAGES = Number(process.env.ROOMSPOT_MAX_PAGES || "3");

interface RoomspotItem {
  title: string;
  url: string;
  rent: number;
  propertyType: string;
  shortDescription: string;
}

function extractListings(page: Page): Promise<RoomspotItem[]> {
  return page.$$eval("section.list-item", (elements) =>
    elements.map((el) => {
      const titleEl = el.querySelector(".object-address");
      const address = titleEl
        ? titleEl.textContent?.trim().replace(/\s+/g, " ")
        : "Unknown Address";
      const typeEl = el.querySelector(".woningtype");
      const propertyType = typeEl
        ? typeEl.textContent?.trim().toLowerCase()
        : "";
      const title = `${address} - ${propertyType}`;
      const linkEl = el.querySelector("a[href]");
      const url = linkEl
        ? "https://www.roomspot.nl" + linkEl.getAttribute("href")
        : "";
      const priceEl = el.querySelector(".prijs");
      const rawPrice = priceEl ? priceEl.textContent?.trim() : "0";
      const cleanPrice =
        Math.round(
          (parseFloat(rawPrice.replace(/[^\d.,]/g, "").replace(",", ".")) ||
            0) * 100,
        ) / 100;

      // Try to capture any short description that is already on the list page.
      const descEl = el.querySelector(
        '[class*="description"], [class*="omschrijving"], [class*="spec"]',
      );
      const shortDescription = descEl
        ? descEl.textContent?.trim().replace(/\s+/g, " ").slice(0, 1000)
        : "";

      return { title, url, rent: cleanPrice, propertyType, shortDescription };
    }),
  );
}

/**
 * Fetch the full description from a Roomspot detail page. Falls back to the
 * short description when the detail page cannot be read.
 */
async function fetchDescription(
  context: BrowserContext,
  item: RoomspotItem,
): Promise<string> {
  if (!item.url) return item.shortDescription;
  const page = await context.newPage();
  try {
    await page.goto(item.url, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });
    const description = await page
      .locator(
        '[class*="description"], [class*="omschrijving"], [class*="text"], article, main',
      )
      .first()
      .textContent()
      .catch(() => "");
    return (description || item.shortDescription)
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 3000);
  } catch {
    return item.shortDescription;
  } finally {
    await page.close().catch(() => undefined);
  }
}

export async function scrapeRoomspot(browser: Browser): Promise<number> {
  console.log("🏠 Starting Roomspot scraper (top priority)...");

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  let newCount = 0;

  try {
    await page.goto(LISTING_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    console.log("✅ Roomspot loaded.");

    // Dismiss cookie banner
    try {
      await page.getByRole("button", { name: "Deny" }).click({ timeout: 3000 });
    } catch {
      // ignore
    }

    // Best-effort lazy authentication (Roomspot session from .env)
    await ensureLoggedIn(page, SOURCE);

    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      try {
        await page.waitForSelector("section.list-item", { timeout: 15000 });
      } catch {
        if (pageNum === 1) {
          console.log("⚠️ No roomspot listings found.");
          await page.screenshot({
            path: "/app/data/roomspot-error.png",
            fullPage: true,
          });
        }
        break;
      }

      const listings = await extractListings(page);
      console.log(
        `🔍 Roomspot page ${pageNum}: ${listings.length} listings found.`,
      );

      for (const item of listings) {
        if (!item.url) continue;

        const result = await insertListing({
          id: hashUrl(item.url),
          title: item.title,
          rent: item.rent,
          url: item.url,
          source: SOURCE,
          address: item.title,
          listing_type: item.propertyType.includes("studio")
            ? "studio"
            : "room",
          description: item.shortDescription || undefined,
          priority: item.rent > 0 && item.rent <= 500 ? "high" : "normal",
        });

        if (result.inserted) {
          newCount++;

          // Roomspot is the #1 source: fetch the full description for new
          // listings so distance and language filters have real text to read.
          const description = await fetchDescription(context, item);
          if (description) {
            await dbUpdateDescription(hashUrl(item.url), description);
          }

          if (item.rent > 0 && item.rent <= 500) {
            await sendDiscordAlert({
              title: item.title,
              rent: item.rent,
              url: item.url,
              source: SOURCE,
              listing_type: item.propertyType.includes("studio")
                ? "studio"
                : "room",
              priority: "high",
            });
          }
        }
      }

      // Pagination — look for a "next" control; break if absent.
      const nextLink = page
        .locator(
          'a[aria-label*="next"], a[aria-label*="volgende"], .pagination a[rel="next"], a.pagination__next',
        )
        .first();
      if ((await nextLink.count()) === 0) break;

      await nextLink.click();
      await page.waitForTimeout(1500);
    }

    console.log(`✅ Roomspot: ${newCount} new listings added.`);
    return newCount;
  } catch (error) {
    console.error("❌ Roomspot scraper error:", error);
    return 0;
  } finally {
    await page.close().catch(() => undefined);
    await context.close().catch(() => undefined);
  }
}

// Local helper to update a listing's description after the detail fetch.
async function dbUpdateDescription(id: string, description: string) {
  await db.execute({
    sql: "UPDATE listings SET description = ? WHERE id = ?",
    args: [description, id],
  });
}
