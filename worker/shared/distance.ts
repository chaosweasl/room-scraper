export type DistanceMode = "cycling" | "walking";

export interface DistanceInfo {
  minutes: number | null;
  mode: DistanceMode | null;
  matchedText: string | null;
}

// These patterns read the distance that landlords/agencies already mention in
// the listing text (for example "10 min fietsen naar de UT"). We deliberately
// do NOT calculate distance ourselves: a full street address is rarely
// available, so routing would be unreliable.

const CYCLING_PATTERNS: RegExp[] = [
  // "10 - 15 min fietsen", "10 tot 15 min fietsen"
  /(\d{1,2})\s*(?:-|–|tot)\s*(\d{1,2})\s*min(?:uten|utes|\.)?\s*(?:fietsen|met de fiets|fiets|cycling|by bike|bike)/i,
  // "10 min fietsen", "10 minuten met de fiets", "10 minutes by bike"
  /(\d{1,2})\s*min(?:uten|utes|\.)?\s*(?:fietsen|met de fiets|fiets|cycling|by bike|bike)/i,
  // "fietsafstand is 10 min"
  /(?:fietsafstand|fietsen|cycling|bike ride)\s*(?:is|:)?\s*(\d{1,2})\s*min(?:uten|utes|\.)?/i,
];

const WALKING_PATTERNS: RegExp[] = [
  // "5 - 10 min lopen", "5 tot 10 min lopen"
  /(\d{1,2})\s*(?:-|–|tot)\s*(\d{1,2})\s*min(?:uten|utes|\.)?\s*(?:lopen|te voet|walking|walk|on foot)/i,
  // "10 min lopen", "10 minutes walking"
  /(\d{1,2})\s*min(?:uten|utes|\.)?\s*(?:lopen|te voet|walking|walk|on foot)/i,
  // "loopafstand 5 min", "walking distance: 5 min"
  /(?:loopafstand|walking distance|te voet)\s*(?:is|:)?\s*(\d{1,2})\s*min(?:uten|utes|\.)?/i,
];

function firstMatch(
  text: string,
  patterns: RegExp[],
  mode: DistanceMode,
): DistanceInfo {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    // For ranges like "10-15 min", use the higher number to be safe.
    const first = match[1] ? parseInt(match[1], 10) : NaN;
    const second = match[2] ? parseInt(match[2], 10) : NaN;
    const minutes = Number.isFinite(second) ? second : first;

    if (Number.isFinite(minutes) && minutes >= 0 && minutes <= 180) {
      return { minutes, mode, matchedText: match[0] };
    }
  }
  return { minutes: null, mode: null, matchedText: null };
}

/**
 * Extract a cycling or walking distance from listing text.
 * Cycling is checked first, then walking.
 */
export function extractDistance(text: string): DistanceInfo {
  if (!text) return { minutes: null, mode: null, matchedText: null };
  const cycling = firstMatch(text, CYCLING_PATTERNS, "cycling");
  if (cycling.minutes !== null) return cycling;
  return firstMatch(text, WALKING_PATTERNS, "walking");
}
