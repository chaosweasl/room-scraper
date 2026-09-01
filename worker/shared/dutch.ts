/**
 * Deterministic Dutch-only detection. This mirrors the standalone
 * scripts/check-dutch-only.py logic so the worker can filter listings without
 * any AI and without fetching every detail page.
 */

const DUTCH_ONLY_PATTERNS: RegExp[] = [
  /\bonly\s+dutch\b/i,
  /\bdutch\s+only\b/i,
  /\ballen\s+nederlands\b/i,
  /nederlands\s+alleen\b/i,
  /\bnederlandstalig\b/i,
  /\bdutch[- ]?speaking\b/i,
  /\bnederlands\s+sprekend\b/i,
  /moet\s+nederlands\s+(?:spreken|kunnen)\b/i,
  /\bmust\s+speak\s+dutch\b/i,
  /\bdutch\s+language\s+(?:required|only)\b/i,
  /\bnederlandse\s+taal\s+(?:vereist|verplicht|nodig)\b/i,
  /\bvoertaal\s+is\s+nederlands\b/i,
  /\bgeen\s+engels\b/i,
  /\bno\s+english\b/i,
  /\bbeheersing\s+van\s+de\s+nederlandse\s+taal\b/i,
  /\bnederlands\s+(?:spreken|praten)\s+(?:we|wij)\b/i,
  /\bwe\s+speak\s+dutch\b/i,
  /\bsamen\s+nederlands\s+(?:spreken|praten)\b/i,
  /\bdutch\s+studenten?\b/i,
  /\bnederlandse\s+studenten?\b/i,
  /\benkel\s+nederlandstalig\b/i,
  /\bwe\s+zijn\s+een\s+nederlands\s+(?:huis|studentenhuis|gezin)\b/i,
  /\bnederlandse?\s+(?:cultuur|gezelligheid|traditie)\b/i,
];

const INTERNATIONAL_PATTERNS: RegExp[] = [
  /\benglish[- ]?speaking\b/i,
  /\bspeak\s+english\b/i,
  /\bengels\s+sprekend\b/i,
  /\binternational\s+students?\s+(?:welcome|encouraged|accepted)\b/i,
  /\binternationals?\s+(?:welcome|accepted|encouraged)\b/i,
  /\bengels\s+(?:is\s+)?(?:prima|ok|goed|geen\s+probleem)\b/i,
  /\benglish\s+(?:is\s+)?(?:fine|ok|welcome|no\s+problem)\b/i,
  /\binternational\s+(?:environment|house|home|atmosphere)\b/i,
  /\bengelstalig\b/i,
  /\bwe\s+speak\s+english\b/i,
  /\bwij\s+spreken\s+engels\b/i,
  /\bopen\s+to\s+internationals?\b/i,
  /\btaal\s+maakt\s+niet\s+uit\b/i,
  /\blanguage\s+(?:does not|doesn't\s+)?(?:matter|not\s+important)\b/i,
];

export interface DutchOnlyResult {
  dutchOnly: boolean;
  reason: string;
}

/**
 * Returns true when the text clearly says Dutch is required.
 * International-friendly signals win over Dutch-only signals.
 */
export function detectDutchOnly(text: string): DutchOnlyResult {
  if (!text) return { dutchOnly: false, reason: "no_text" };
  const lower = text.toLowerCase();

  for (const pattern of INTERNATIONAL_PATTERNS) {
    if (pattern.test(lower)) {
      return { dutchOnly: false, reason: "international_friendly" };
    }
  }

  for (const pattern of DUTCH_ONLY_PATTERNS) {
    if (pattern.test(lower)) {
      return { dutchOnly: true, reason: "dutch_only_text" };
    }
  }

  return { dutchOnly: false, reason: "no_signal" };
}
