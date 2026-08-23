import {
  db,
  Listing,
  getAllSettings,
  setListingDraft,
  setListingTriage,
  updateListingStatus,
} from "./db";
import { commuteMinutesToCampus } from "./commute";
import { hermesGatekeeper, hermesDraft } from "./hermes";
import { postDraftedListing } from "../bot";

/**
 * Run the AI triage + commute engine for a single listing.
 *
 * Order:
 *   1. Hard rent cap (profile dealbreaker)          → auto_rejected
 *   2. Commute (OSRM bike minutes) over the limit   → auto_rejected
 *   3. Hermes Pass 1 gatekeeper (dealbreakers)      → auto_rejected
 *   4. Hermes Pass 2 drafter                        → drafted
 *
 * Returns the resulting status. Gracefully skips Hermes/OSRM when not
 * configured so the core scraper keeps working without AI.
 */
export async function triageListing(listing: Listing): Promise<string> {
  const profile = await getAllSettings();

  // 1. Hard rent cap
  const maxRent = Number(profile.max_rent || "0");
  if (maxRent > 0 && listing.rent > maxRent) {
    await setListingTriage(
      listing.id,
      `rent_${listing.rent}_over_${maxRent}`,
      null,
    );
    await updateListingStatus(listing.id, "auto_rejected");
    return "auto_rejected";
  }

  // 2. Commute filter
  const maxBike = Number(profile.max_bike_minutes_to_campus || "20");
  const location =
    [listing.address, listing.title].find((s) => s && s.trim().length >= 3) ||
    "Enschede";
  const minutes = await commuteMinutesToCampus(location);
  await setListingTriage(
    listing.id,
    minutes !== null ? `commute_${minutes}min` : "commute_unknown",
    minutes,
  );
  if (minutes !== null && minutes > maxBike) {
    await updateListingStatus(listing.id, "auto_rejected");
    return "auto_rejected";
  }

  // Hermes triage is optional — leave listings 'new' when AI isn't configured.
  if (!process.env.HERMES_API_KEY) {
    return "new";
  }

  try {
    // 3. Gatekeeper
    const gate = await hermesGatekeeper(listing, profile);
    if (!gate.pass) {
      await setListingTriage(listing.id, `gatekeeper: ${gate.reason}`, minutes);
      await updateListingStatus(listing.id, "auto_rejected");
      return "auto_rejected";
    }

    // 4. Drafter
    const draft = await hermesDraft(listing, "auto", profile);
    await setListingDraft(listing.id, draft.body, draft.language);
    await updateListingStatus(listing.id, "drafted");
    void postDraftedListing(listing.id).catch((err) =>
      console.error("❌ Failed to post drafted listing to Discord:", err),
    );
    return "drafted";
  } catch (err) {
    console.warn(`⚠️ Hermes triage failed for ${listing.id}:`, err);
    return "new";
  }
}

/**
 * Triage every listing currently in status 'new'.
 */
export async function triageNewListings(): Promise<Record<string, number>> {
  const res = await db.execute({
    sql: "SELECT * FROM listings WHERE status = 'new'",
    args: [],
  });

  const stats: Record<string, number> = {
    drafted: 0,
    auto_rejected: 0,
    new: 0,
  };

  for (const row of res.rows) {
    const listing = row as unknown as Listing;
    const outcome = await triageListing(listing);
    stats[outcome] = (stats[outcome] || 0) + 1;
  }

  return stats;
}
