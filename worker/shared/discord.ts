export async function sendDiscordAlert(listing: {
  title: string;
  rent: number;
  url: string;
  source: string;
  address?: string;
  listing_type?: string;
  priority?: string;
}) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl || webhookUrl === 'your_discord_webhook_here') {
    console.log('⚠️ Discord webhook not configured — skipping alert');
    return;
  }

  const priorityEmoji = listing.priority === 'high' ? '🔴 URGENT' : '🟡';
  const typeStr = listing.listing_type ? ` (${listing.listing_type})` : '';
  const addressStr = listing.address ? `\n**Location:** ${listing.address}` : '';

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `${priorityEmoji} **NEW ${listing.source.toUpperCase()} LISTING!** ${priorityEmoji}\n**Title:** ${listing.title}${typeStr}\n**Rent:** €${listing.rent}${addressStr}\n**Link:** ${listing.url}`
      })
    });
    console.log(`🔔 Discord alert sent for: ${listing.title}`);
  } catch (err) {
    console.error('❌ Failed to send Discord alert:', err);
  }
}