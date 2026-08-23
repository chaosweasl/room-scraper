import { createClient } from "@libsql/client";
import { NextResponse } from "next/server";

const db = createClient({
  url: process.env.DATABASE_URL || "file:/app/data/housing.db",
});

export async function GET() {
  const res = await db.execute("SELECT key, value FROM settings");
  const out: Record<string, string> = {};
  for (const row of res.rows) {
    out[row.key as string] = row.value as string;
  }
  return NextResponse.json(out);
}

export async function POST(request: Request) {
  const body = (await request.json()) as Record<string, unknown>;

  for (const [key, value] of Object.entries(body)) {
    await db.execute({
      sql: "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: [key, String(value)],
    });
  }

  return NextResponse.json({ ok: true });
}
