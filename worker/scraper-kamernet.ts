import { ensureSchema, insertListing } from './shared/db';

const SOURCE = 'kamernet';
const BASE = 'https://kamernet.nl';
const CITY = 'enschede';
const MAX_RENT = 650; // Capture up to €650 — above that, even huurtoeslag won't bridge it
const HUURTOESLAG_THRESHOLD = 500; // Listings above this need toeslag check
const MAX_PAGES = 15; // Kamernet shows up to 15 pages

// Listing type names for URL construction
const LISTING_TYPE_MAP: Record<number, string> = {
  1: 'room',
  2: 'apartment',
  3: 'studio',
  4: 'student-housing',
};

// Furnishing IDs:
// 1 = uncarpeted, 2 = unfurnished, 3 = ?, 4 = furnished

interface KamernetListing {
  listingId: number;
  street: string;
  streetSlug: string;
  city: string;
  citySlug: string;
  totalRentalPrice: number;
  utilitiesIncluded: boolean;
  listingType: number;
  surfaceArea: number;
  availabilityStartDate: string;
  furnishingId: number;
  isNewAdvert: boolean;
  isStudentHouseAdvert: boolean;
  studentHouseId: number | null;
  fullPreviewImageUrl: string;
}

interface PageData {
  listings: KamernetListing[];
  total: number;
}

/**
 * Fetch one page of Kamernet search results and parse __NEXT_DATA__
 */
async function fetchPage(page: number): Promise<PageData | null> {
  const url = `${BASE}/en/for-rent/room-${CITY}?page=${page}`;
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      console.error(`❌ Kamernet page ${page}: HTTP ${resp.status}`);
      return null;
    }
    const html = await resp.text();

    // Extract __NEXT_DATA__ JSON
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/);
    if (!match) {
      console.error(`❌ Kamernet page ${page}: No __NEXT_DATA__ found`);
      return null;
    }

    const data = JSON.parse(match[1]);
    const fr = data?.props?.pageProps?.targetPageProps?.findListingsResponse;
    if (!fr?.listings) {
      console.error(`❌ Kamernet page ${page}: No listings in data`);
      return null;
    }

    return {
      listings: fr.listings as KamernetListing[],
      total: fr.total as number,
    };
  } catch (err) {
    console.error(`❌ Kamernet page ${page} error:`, (err as Error).message);
    return null;
  }
}

/**
 * Build the listing detail URL on Kamernet
 */
function buildListingUrl(listing: KamernetListing): string {
  const typeSlug = LISTING_TYPE_MAP[listing.listingType] || 'room';
  const typeId = listing.listingType === 1 ? 'room' : listing.listingType === 2 ? 'apartment' : 'studio';
  return `${BASE}/en/for-rent/${typeSlug}-${listing.citySlug}/${listing.streetSlug}/${typeId}-${listing.listingId}`;
}

/**
 * Scrape Kamernet for Enschede listings
 */
export async function scrapeKamernet(): Promise<number> {
  console.log(`🔍 Starting Kamernet scraper for ${CITY} (max €${MAX_RENT})...`);
  await ensureSchema();

  let newCount = 0;
  let totalSeen = 0;
  let totalAvailable = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const pageData = await fetchPage(page);
    if (!pageData) break;

    const { listings, total } = pageData;
    totalAvailable = total;
    console.log(`  Page ${page}: ${listings.length} listings (total available: ${total})`);

    let anyOnPage = false;
    for (const l of listings) {
      totalSeen++;

      // Skip listings way over budget (even huurtoeslag won't help)
      if (l.totalRentalPrice > MAX_RENT) continue;
      anyOnPage = true;

      // Build listing ID (source-specific)
      const listingId = `kamernet-${l.listingId}`;
      const url = buildListingUrl(l);

      // Build title
      const typeName = LISTING_TYPE_MAP[l.listingType] || 'Property';
      const furnishing = l.furnishingId === 4 ? 'furnished' : l.furnishingId === 2 ? 'unfurnished' : '';
      const studentTag = l.isStudentHouseAdvert ? ' (student house)' : '';
      const title = `${typeName}${studentTag} — ${l.street}, ${l.city} — ${l.surfaceArea}m² ${furnishing}`.trim();

      // Build address
      const address = `${l.street}, ${l.city}`;

      // Priority + huurtoeslag awareness
      let priority = 'normal';
      let toeslagNote = '';
      if (l.totalRentalPrice <= 400) {
        priority = 'high'; // Instant Discord alert
      } else if (l.totalRentalPrice <= HUURTOESLAG_THRESHOLD) {
        priority = 'high'; // Under €500 — safe buy
      } else {
        // €500-€650: needs huurtoeslag check — basis huur (excl. utilities) may qualify
        toeslagNote = '\n⚠️ Over €500 — check if basis huur qualifies for huurtoeslag (under-21 threshold ~€498)';
        priority = 'normal';
      }

      // Description
      const availDate = l.availabilityStartDate
        ? `Available from: ${new Date(l.availabilityStartDate).toLocaleDateString('en-GB')}`
        : 'Availability not specified';
      const utils = l.utilitiesIncluded ? 'Utilities included' : 'Utilities excluded';
      const img = l.fullPreviewImageUrl ? `\nImage: ${l.fullPreviewImageUrl}` : '';
      const description = `${typeName} in ${l.city}\n${l.surfaceArea}m², ${furnishing || 'furnishing not specified'}\n€${l.totalRentalPrice}/mo (${utils})\n${availDate}${toeslagNote}${img}`;

      const result = await insertListing({
        id: listingId,
        title,
        rent: l.totalRentalPrice,
        url,
        source: SOURCE,
        address,
        listing_type: typeName,
        description,
        priority,
      });

      if (result.inserted) {
        newCount++;
        console.log(`  ✅ NEW: €${l.totalRentalPrice} — ${l.street}, ${l.city}`);
      } else if (result.isNew === false) {
        // Already in DB — skip silently
      }
    }

    // If no listings on this page were in budget and we've done 5+ pages, stop early
    if (!anyOnPage && page >= 5) {
      console.log(`  ⏹️ No more listings under €${MAX_RENT} — stopping at page ${page}`);
      break;
    }

    // Small delay to avoid hammering
    if (page < MAX_PAGES) {
      await new Promise(r => setTimeout(r, 500 + Math.random() * 500));
    }
  }

  console.log(`📊 Kamernet: ${totalSeen} listings checked, ${newCount} new found (total available: ${totalAvailable})`);
  return newCount;
}

// Allow standalone run
if (require.main === module) {
  scrapeKamernet().then(n => {
    console.log(`\n🏁 Done — ${n} new listings`);
    process.exit(0);
  }).catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
