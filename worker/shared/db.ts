import { createClient } from '@libsql/client';

export const db = createClient({
  url: process.env.DATABASE_URL || 'file:/app/data/housing.db',
});

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

  // Add columns that might be missing from the old schema
  const migrations = [
    "ALTER TABLE listings ADD COLUMN source TEXT",
    "ALTER TABLE listings ADD COLUMN address TEXT",
    "ALTER TABLE listings ADD COLUMN listing_type TEXT",
    "ALTER TABLE listings ADD COLUMN phone TEXT",
    "ALTER TABLE listings ADD COLUMN description TEXT",
    "ALTER TABLE listings ADD COLUMN date_found TEXT",
    "ALTER TABLE listings ADD COLUMN priority TEXT DEFAULT 'normal'",
  ];

  for (const sql of migrations) {
    try {
      await db.execute(sql);
    } catch {
      // Column already exists — ignore
    }
  }
}

export async function insertListing(listing: {
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
}) {
  const existing = await db.execute({
    sql: "SELECT id FROM listings WHERE id = ?",
    args: [listing.id],
  });

  if (existing.rows.length > 0) {
    return { inserted: false, isNew: false };
  }

  const dateFound = new Date().toISOString();

  await db.execute({
    sql: `INSERT OR REPLACE INTO listings 
      (id, title, rent, status, url, source, address, listing_type, phone, description, date_found, priority)
      VALUES (?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      listing.priority || 'normal',
    ],
  });

  return { inserted: true, isNew: true };
}