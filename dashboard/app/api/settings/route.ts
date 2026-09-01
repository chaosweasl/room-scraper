import { createClient } from "@libsql/client";
import { NextResponse } from "next/server";

// Never run this route at build time; the database only exists at runtime.
export const dynamic = "force-dynamic";

// Same defaults as the worker, so the settings page works even before the
// worker has had a chance to seed the settings table.
const DEFAULT_SETTINGS: Record<string, string> = {
  scraper_roomspot: "true",
  scraper_marktplaats: "true",
  scraper_pararius: "true",
  scraper_xior: "true",
  scraper_kamernet: "true",
  user_name: "",
  user_email: "",
  skip_dutch_only: "true",
  max_rent: "600",
  rent_flex: "100",
  max_bike_minutes: "20",
  max_walk_minutes: "25",
  apply_mode: "off",
  template_landlord: [
    "Dear landlord,",
    "",
    'My name is {{name}}. I am a student at the University of Twente and I am very interested in your listing "{{title}}" at {{address}} for €{{rent}} per month.',
    "",
    "I am a quiet, tidy and responsible person. I do not smoke and I have no pets. I would love to schedule a viewing or answer any questions you may have.",
    "",
    "You can reach me at {{email}}.",
    "",
    "Best regards,",
    "{{name}}",
  ].join("\n"),
  template_cooptation: [
    "Hi!",
    "",
    "My name is {{name}}, and I am a student at the University of Twente. I saw your room at {{address}} and I would love to introduce myself.",
    "",
    "I am easy-going, clean, and I like both studying and spending time together. No pets, no smoking, and I am looking for a longer stay.",
    "",
    "Feel free to message me at {{email}}. Hope to hear from you!",
    "",
    "Cheers,",
    "{{name}}",
  ].join("\n"),
};

function getDb() {
  return createClient({
    url: process.env.DATABASE_URL || "file:/app/data/housing.db",
  });
}

export async function GET() {
  const db = getDb();
  const res = await db.execute("SELECT key, value FROM settings");
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of res.rows) {
    out[row.key as string] = row.value as string;
  }
  return NextResponse.json(out);
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;
  const db = getDb();

  for (const [key, value] of Object.entries(body)) {
    await db.execute({
      sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: [key, String(value)],
    });
  }

  return NextResponse.json({ ok: true });
}
