import { createClient } from "@libsql/client";
import { NextResponse } from "next/server";

const VALID_STATUSES = [
  "new",
  "drafted",
  "applied",
  "rejected",
  "auto_rejected",
];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const status = body.status as string | undefined;

  if (!status || !VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }

  const db = createClient({
    url: process.env.DATABASE_URL || "file:/app/data/housing.db",
  });

  const args: (string | null)[] = [status, id];
  const emailedAt = status === "applied" ? new Date().toISOString() : null;

  if (status === "applied") {
    await db.execute({
      sql: "UPDATE listings SET status = ?, emailed_at = ? WHERE id = ?",
      args: [status, emailedAt, id],
    });
  } else {
    await db.execute({
      sql: "UPDATE listings SET status = ? WHERE id = ?",
      args: [status, id],
    });
  }

  return NextResponse.json({ ok: true });
}
