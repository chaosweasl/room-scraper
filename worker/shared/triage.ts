import {
  db,
  Listing,
  getBooleanSetting,
  getNumberSetting,
  setListingDraft,
  setListingTriage,
  updateListingStatus,
} from "./db";
import { extractDistance } from "./distance";
import { detectDutchOnly } from "./dutch";
import { chooseTemplate, draftLanguage, renderListingDraft } from "./templates";
import { postDraftedListing } from "../bot";

/**
 * Run the triage engine for a single listing.
 *
 * Order:
 *   1. Rent (soft cap + hard cap)           -> auto_rejected only when too far over
 *   2. Dutch-only skip (when enabled)       -> auto_rejected
 *   3. Distance from the listing description -> auto_rejected when over limit
 *   4. Template draft                       -> drafted
 *
 * Everything is deterministic — there is no AI step.
 */
export async function triageListing(listing: Listing): Promise<string> {
  const maxRent = await getNumberSetting("max_rent", 0);
  const rentFlex = await getNumberSetting("rent_flex", 100);
  const skipDutchOnly = await getBooleanSetting("skip_dutch_only", true);
  const maxBike = await getNumberSetting("max_bike_minutes", 20);
  const maxWalk = await getNumberSetting("max_walk_minutes", 25);

  // 1. Rent.
  if (maxRent > 0 && listing.rent > 0) {
    // Hard cap: reject only when the rent is above budget + flexibility.
    if (listing.rent > maxRent + rentFlex) {
      await setListingTriage(
        listing.id,
        `rent_${listing.rent}_over_${maxRent + rentFlex}`,
        null,
        null,
      );
      await updateListingStatus(listing.id, "auto_rejected");
      return "auto_rejected";
    }

    // Soft cap: keep listings slightly over budget, but flag them.
    if (listing.rent > maxRent) {
      await setListingTriage(
        listing.id,
        `over_budget_by_${Math.round(listing.rent - maxRent)}`,
        null,
        null,
      );
    }
  }

  // 2. Dutch-only skip. Only the text we already scraped is checked.
  if (skipDutchOnly) {
    const combined = `${listing.title}\n${listing.description || ""}`;
    const result = detectDutchOnly(combined);
    if (result.dutchOnly) {
      await setListingTriage(listing.id, "dutch_only", null, null);
      await updateListingStatus(listing.id, "auto_rejected");
      return "auto_rejected";
    }
  }

  // 3. Distance from the description text (cycling or walking). A listing is
  // only rejected when a distance IS mentioned and that distance is over the
  // limit. Listings without distance info are never excluded here.
  const combinedText = `${listing.title}\n${listing.description || ""}`;
  const distance = extractDistance(combinedText);
  if (distance.minutes !== null) {
    await setListingTriage(
      listing.id,
      `${distance.mode}_${distance.minutes}min`,
      distance.minutes,
      distance.mode,
    );

    if (distance.mode === "cycling" && distance.minutes > maxBike) {
      await updateListingStatus(listing.id, "auto_rejected");
      return "auto_rejected";
    }
    if (distance.mode === "walking" && distance.minutes > maxWalk) {
      await updateListingStatus(listing.id, "auto_rejected");
      return "auto_rejected";
    }
  } else {
    await setListingTriage(listing.id, "distance_not_mentioned", null, null);
  }

  // 4. Template draft.
  const profile = await getAllSettingsForDraft();
  const template = chooseTemplate(listing.listing_type, {
    landlord: profile.template_landlord,
    cooptation: profile.template_cooptation,
  });
  const body = renderListingDraft(
    { listing, userName: profile.user_name, userEmail: profile.user_email },
    template,
  );
  await setListingDraft(listing.id, body, draftLanguage(listing));
  await updateListingStatus(listing.id, "drafted");
  void postDraftedListing(listing.id).catch((err) =>
    console.error("❌ Failed to post drafted listing to Discord:", err),
  );
  return "drafted";
}

async function getAllSettingsForDraft(): Promise<{
  user_name: string;
  user_email: string;
  template_landlord: string;
  template_cooptation: string;
}> {
  const res = await db.execute("SELECT key, value FROM settings");
  const settings: Record<string, string> = {};
  for (const row of res.rows) {
    settings[row.key as string] = row.value as string;
  }
  return {
    user_name: settings.user_name || "",
    user_email: settings.user_email || "",
    template_landlord: settings.template_landlord || "",
    template_cooptation: settings.template_cooptation || "",
  };
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
