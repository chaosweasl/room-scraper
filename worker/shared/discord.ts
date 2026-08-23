// Simple rate limiter: serialize webhook sends with a minimum interval so a burst
// of cheap listings in one cycle doesn't hammer the Discord webhook.
let sendQueue: Promise<void> = Promise.resolve();
const MIN_SEND_INTERVAL_MS = 750;

function scheduleSend(task: () => Promise<void>): Promise<void> {
  const next = sendQueue.then(async () => {
    await task();
    await new Promise((resolve) => setTimeout(resolve, MIN_SEND_INTERVAL_MS));
  });
  // Keep the chain alive even if a send fails
  sendQueue = next.catch(() => undefined);
  return next;
}

/**
 * Send a raw text message to the configured Discord webhook (rate-limited).
 */
export async function sendDiscordMessage(content: string) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl || webhookUrl === "your_discord_webhook_here") {
    console.log("⚠️ Discord webhook not configured — skipping message");
    return;
  }

  await scheduleSend(async () => {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      console.log("🔔 Discord message sent");
    } catch (err) {
      console.error("❌ Failed to send Discord message:", err);
    }
  });
}

export async function sendDiscordAlert(listing: {
  title: string;
  rent: number;
  url: string;
  source: string;
  address?: string;
  listing_type?: string;
  priority?: string;
}) {
  const priorityEmoji = listing.priority === "high" ? "🔴" : "🟡";
  const typeStr = listing.listing_type ? ` (${listing.listing_type})` : "";
  const addressStr = listing.address
    ? `\n**Location:** ${listing.address}`
    : "";

  await sendDiscordMessage(
    `${priorityEmoji} **NEW ${listing.source.toUpperCase()} LISTING!**\n**Title:** ${listing.title}${typeStr}\n**Rent:** €${listing.rent}${addressStr}\n**Link:** ${listing.url}`,
  );
}
