import { Listing } from "./db";

/**
 * Fill a message template. Supported placeholders:
 *   {{name}} {{email}} {{title}} {{address}} {{rent}} {{type}} {{source}}
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => {
    const value = vars[key];
    return value === undefined ? "" : value;
  });
}

export interface TemplateContext {
  listing: Listing;
  userName: string;
  userEmail: string;
}

function buildVars(context: TemplateContext): Record<string, string> {
  const { listing, userName, userEmail } = context;
  return {
    name: userName || "your name",
    email: userEmail || "your email",
    title: listing.title,
    address: listing.address || listing.title,
    rent:
      listing.rent > 0 ? String(Math.round(listing.rent)) : "the listed price",
    type: listing.listing_type || "room",
    source: listing.source,
  };
}

/**
 * Choose the casual template for shared-living listings (rooms / student
 * houses) and the semi-formal template for studios, apartments and houses.
 */
export function chooseTemplate(
  listingType: string | null,
  templates: { landlord: string; cooptation: string },
): string {
  const type = (listingType || "").toLowerCase();
  if (
    type.includes("room") ||
    type.includes("kamer") ||
    type.includes("student")
  ) {
    return templates.cooptation;
  }
  return templates.landlord;
}

export function renderListingDraft(
  context: TemplateContext,
  template: string,
): string {
  return renderTemplate(template, buildVars(context)).trim();
}

/**
 * Draft language label. The user writes the templates themselves, so the label
 * is informational only and defaults to "en" unless a Dutch source is detected.
 */
export function draftLanguage(listing: Listing): string {
  const dutchSources = ["marktplaats", "roomspot", "pararius", "kamernet"];
  return dutchSources.includes(listing.source) ? "nl" : "en";
}
