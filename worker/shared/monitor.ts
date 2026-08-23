import { sendDiscordMessage } from "./discord";

export interface SourceStats {
  source: string;
  lastCount: number;
  lastSuccessAt: string | null;
  consecutiveZero: number;
  lastError: string | null;
}

const stats = new Map<string, SourceStats>();

const ZERO_ALERT_THRESHOLD = Number(
  process.env.ZERO_RESULT_ALERT_THRESHOLD || "3",
);

function getStat(source: string): SourceStats {
  let s = stats.get(source);
  if (!s) {
    s = {
      source,
      lastCount: 0,
      lastSuccessAt: null,
      consecutiveZero: 0,
      lastError: null,
    };
    stats.set(source, s);
  }
  return s;
}

/**
 * Record the outcome of one source's scrape cycle. Tracks consecutive zero-result
 * cycles and fires a Discord health alert once the threshold is crossed.
 */
export function recordSourceResult(
  source: string,
  newCount: number,
  error?: string,
): SourceStats {
  const s = getStat(source);
  const now = new Date().toISOString();

  s.lastCount = newCount;
  s.lastError = error || null;
  if (!error) {
    s.lastSuccessAt = now;
  }
  s.consecutiveZero = newCount === 0 ? s.consecutiveZero + 1 : 0;

  if (s.consecutiveZero > 0 && s.consecutiveZero >= ZERO_ALERT_THRESHOLD) {
    void sendDiscordMessage(
      `🚨 **Source health alert** — \`${source}\` returned 0 listings for ${s.consecutiveZero} consecutive cycles. Possible site redesign or Cloudflare block.`,
    ).catch(() => undefined);
  }

  return s;
}

export function getStats(): SourceStats[] {
  return [...stats.values()];
}
