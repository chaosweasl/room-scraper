import { createHash } from "crypto";

/**
 * Deterministic SHA-256 hash of a listing URL. Used as the canonical listing ID
 * so the same listing never gets a new random ID (and never re-inserted as new).
 */
export function hashUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex");
}
