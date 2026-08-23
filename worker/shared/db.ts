import { createClient } from "@libsql/client";

export const db = createClient({
  url: process.env.DATABASE_URL || "file:/app/data/housing.db",
});

// Enable WAL + a busy timeout so the dashboard (reader) and worker (writer) can
// coexist on the same SQLite file. Ignored gracefully for remote (Turso) URLs.
(async () => {
  try {
    await db.execute("PRAGMA journal_mode = WAL");
    await db.execute("PRAGMA busy_timeout = 5000");
  } catch (err) {
    console.warn("⚠️ Could not enable WAL/busy_timeout (remote DB?) —", err);
  }
})();

export interface Listing {
  id: string;
  title: string;
  rent: number;
  status: string;
  url: string;
  source: string;
  address: string;
  listing_type: string;
  phone: string;
  description: string;
  date_found: string;
  priority: string;
  emailed_at: string | null;
  last_draft: string | null;
  draft_body: string | null;
  draft_language: string | null;
  triage_reason: string | null;
  commute_minutes: number | null;
}

export async function ensureSchema() {
  // Create the base table if it doesn't exist (with all columns)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      title TEXT,
      rent REAL,
      status TEXT DEFAULT 'new',
      url TEXT,
      source TEXT,
      address TEXT,
      listing_type TEXT,
      phone TEXT,
      description TEXT,
      date_found TEXT,
      priority TEXT DEFAULT 'normal'
    )
  `);

  // Idempotent column migration: only add columns that are actually missing.
  const cols = await db.execute("PRAGMA table_info(listings)");
  const existing = new Set(cols.rows.map((r) => r.name as string));
  const desired: Array<[string, string]> = [
    ["source", "TEXT"],
    ["address", "TEXT"],
    ["listing_type", "TEXT"],
    ["phone", "TEXT"],
    ["description", "TEXT"],
    ["date_found", "TEXT"],
    ["priority", "TEXT DEFAULT 'normal'"],
    ["emailed_at", "TEXT"],
    ["last_draft", "TEXT"],
    ["draft_body", "TEXT"],
    ["draft_language", "TEXT"],
    ["triage_reason", "TEXT"],
    ["commute_minutes", "REAL"],
  ];

  for (const [col, def] of desired) {
    if (!existing.has(col)) {
      await db.execute(`ALTER TABLE listings ADD COLUMN ${col} ${def}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Settings — key/value table holding the user's profile, dealbreakers, and
// per-platform toggles (managed from the dashboard Configurator UI).
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: Record<string, string> = {
  scraper_kamernet: "true",
  scraper_marktplaats: "true",
  scraper_pararius: "true",
  scraper_roomspot: "true",
  scraper_xior: "true",
  lang_req: "english_allowed",
  pets: "no_pets_allowed",
  min_age: "19",
  max_rent: "600",
  max_bike_minutes_to_campus: "20",
};

export async function ensureSettings() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.execute({
      sql: "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
      args: [key, value],
    });
  }
}

export async function getSetting(key: string): Promise<string | null> {
  const res = await db.execute({
    sql: "SELECT value FROM settings WHERE key = ?",
    args: [key],
  });
  return res.rows.length > 0 ? (res.rows[0].value as string) : null;
}

export async function getAllSettings(): Promise<Record<string, string>> {
  const res = await db.execute("SELECT key, value FROM settings");
  const out: Record<string, string> = {};
  for (const row of res.rows) {
    out[row.key as string] = row.value as string;
  }
  return out;
}

export async function setSetting(key: string, value: string) {
  await db.execute({
    sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [key, value],
  });
}

export async function isScraperEnabled(source: string): Promise<boolean> {
  const val = await getSetting(`scraper_${source}`);
  if (val === null) return true; // default enabled if not configured
  return val === "true" || val === "1";
}

// ---------------------------------------------------------------------------
// Listing mutations
// ---------------------------------------------------------------------------

export interface ListingInput {
  id: string;
  title: string;
  rent: number;
  url: string;
  source: string;
  address?: string;
  listing_type?: string;
  phone?: string;
  description?: string;
  priority?: string;
}

export async function insertListing(listing: ListingInput) {
  const dateFound = new Date().toISOString();

  const result = await db.execute({
    sql: `INSERT INTO listings
        (id, title, rent, status, url, source, address, listing_type, phone, description, date_found, priority)
      VALUES (?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
    args: [
      listing.id,
      listing.title,
      listing.rent,
      listing.url,
      listing.source,
      listing.address || null,
      listing.listing_type || null,
      listing.phone || null,
      listing.description || null,
      dateFound,
      listing.priority || "normal",
    ],
  });

  const inserted = (result.rowsAffected ?? 0) > 0;
  return { inserted, isNew: inserted };
}

export async function updateListingStatus(id: string, status: string) {
  await db.execute({
    sql: "UPDATE listings SET status = ? WHERE id = ?",
    args: [status, id],
  });
}

export async function setListingDraft(
  id: string,
  draftBody: string,
  draftLanguage: string,
) {
  await db.execute({
    sql: "UPDATE listings SET draft_body = ?, draft_language = ?, last_draft = ? WHERE id = ?",
    args: [draftBody, draftLanguage, new Date().toISOString(), id],
  });
}

export async function markListingApplied(id: string) {
  await db.execute({
    sql: "UPDATE listings SET status = 'applied', emailed_at = ? WHERE id = ?",
    args: [new Date().toISOString(), id],
  });
}

export async function setListingTriage(
  id: string,
  reason: string,
  commuteMinutes: number | null,
) {
  await db.execute({
    sql: "UPDATE listings SET triage_reason = ?, commute_minutes = ? WHERE id = ?",
    args: [reason, commuteMinutes, id],
  });
}

export async function getListingById(id: string): Promise<Listing | null> {
  const res = await db.execute({
    sql: "SELECT * FROM listings WHERE id = ?",
    args: [id],
  });
  if (res.rows.length === 0) return null;
  return res.rows[0] as unknown as Listing;
}
