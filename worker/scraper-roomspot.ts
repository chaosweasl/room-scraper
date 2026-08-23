import { Browser } from "playwright";
import { insertListing } from "./shared/db";
import { sendDiscordAlert } from "./shared/discord";
import { hashUrl } from "./shared/hash";
import { ensureLoggedIn } from "./shared/auth";

const SOURCE = "roomspot";
const LISTING_URL = "https://www.roomspot.nl/en/housing-offer/to-rent";
const MAX_PAGES = Number(process.env.ROOMSPOT_MAX_PAGES || "3");

export async function scrapeRoomspot(browser: Browser): Promise<number> {
  console.log("🏠 Starting Roomspot scraper...");

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
      // Wait for listings
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

      const listings = await page.$$eval("section.list-item", (elements) =>
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
          return { title, url, cleanPrice };
        }),
      );

      console.log(
        `🔍 Roomspot page ${pageNum}: ${listings.length} listings found.`,
      );

      for (const item of listings) {
        const result = await insertListing({
          id: hashUrl(item.url),
          title: item.title,
          rent: item.cleanPrice,
          url: item.url,
          source: SOURCE,
          address: item.title,
          listing_type: item.title.toLowerCase().includes("studio")
            ? "studio"
            : "room",
          priority:
            item.cleanPrice > 0 && item.cleanPrice <= 500 ? "high" : "normal",
        });

        if (result.inserted) {
          newCount++;
          // Discord alert for cheap listings near campus
          if (item.cleanPrice > 0 && item.cleanPrice <= 500) {
            await sendDiscordAlert({
              title: item.title,
              rent: item.cleanPrice,
              url: item.url,
              source: SOURCE,
              listing_type: item.title.toLowerCase().includes("studio")
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
    await page.close();
    await context.close();
  }
}
