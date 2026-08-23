import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  TextChannel,
} from "discord.js";
import {
  getAllSettings,
  getListingById,
  markListingApplied,
  setListingDraft,
  updateListingStatus,
} from "./shared/db";
import { hermesDraft } from "./shared/hermes";
import { submitApplication } from "./shared/apply";
import { getStats } from "./shared/monitor";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const EXECUTION_MODE = process.env.EXECUTION_MODE || "manual";
const DRY_RUN = process.env.DRY_RUN === "true";

let client: Client | null = null;

export function startBot() {
  if (!TOKEN || !CHANNEL_ID) {
    console.log(
      "⚠️ Discord bot not configured (DISCORD_BOT_TOKEN / DISCORD_CHANNEL_ID) — skipping",
    );
    return;
  }

  client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  client.once(Events.ClientReady, async () => {
    console.log(`🤖 Discord bot ready as ${client?.user?.tag}`);

    // Register a simple slash command for health checks
    try {
      await client?.application?.commands.create({
        name: "status",
        description: "Show scraper source health",
      });
    } catch (err) {
      console.warn("⚠️ Could not register slash command:", err);
    }
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction);
  });

  client.login(TOKEN);
}

function buildButtons(listingId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`send:${listingId}`)
      .setLabel("✅ Send Application")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`retry_formal:${listingId}`)
      .setLabel("🔄 Retry: Too Formal")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`retry_casual:${listingId}`)
      .setLabel("🔄 Retry: Too Casual")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`reject:${listingId}`)
      .setLabel("❌ Reject/Skip")
      .setStyle(ButtonStyle.Danger),
  );
}

/**
 * Post a drafted listing to the configured Discord channel. In manual mode the
 * Send button is omitted — the user copies the draft manually.
 */
export async function postDraftedListing(id: string) {
  if (!client || !CHANNEL_ID) return;
  const listing = await getListingById(id);
  if (!listing || !listing.draft_body) return;

  try {
    const channel = await client.channels.fetch(CHANNEL_ID);
    if (!channel || !channel.isTextBased()) return;
    const textChannel = channel as TextChannel;

    const embed = new EmbedBuilder()
      .setTitle(listing.title)
      .setURL(listing.url)
      .setColor(0x5865f2)
      .addFields(
        { name: "Rent", value: `€${listing.rent}`, inline: true },
        { name: "Location", value: listing.address || "—", inline: true },
        { name: "Source", value: listing.source, inline: true },
      );

    if (listing.description) {
      embed.setDescription(listing.description.slice(0, 500));
    }

    embed.addFields({
      name: "✉️ Draft",
      value: listing.draft_body.slice(0, 1024),
    });

    const components = EXECUTION_MODE === "auto" ? [buildButtons(id)] : [];
    await textChannel.send({ embeds: [embed], components });
  } catch (err) {
    console.error("❌ Failed to post Discord embed:", err);
  }
}

async function handleInteraction(interaction: any) {
  if (!interaction.isButton()) {
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "status"
    ) {
      const sources = getStats()
        .map(
          (s) =>
            `**${s.source}**: ${s.lastCount} new, zero-streak ${s.consecutiveZero}, last success ${s.lastSuccessAt ?? "—"}`,
        )
        .join("\n");
      await interaction.reply({
        content: sources || "No scraper cycles completed yet.",
        ephemeral: true,
      });
    }
    return;
  }

  const [action, id] = interaction.customId.split(":");
  await interaction.deferUpdate();

  try {
    switch (action) {
      case "send": {
        const listing = await getListingById(id);
        if (!listing) {
          await interaction.followUp({
            content: "Listing not found.",
            ephemeral: true,
          });
          return;
        }
        const result = await submitApplication(listing, { dryRun: DRY_RUN });
        if (result.screenshotPath) {
          await interaction.followUp({
            content: "🧪 **DRY-RUN** — form filled but NOT submitted:",
            files: [result.screenshotPath],
          });
        } else if (result.success) {
          await markListingApplied(id);
          await interaction.followUp({
            content: `✅ Application submitted for "${listing.title}".`,
          });
        } else {
          await interaction.followUp({
            content: `⚠️ ${result.message}`,
          });
        }
        break;
      }
      case "retry_formal":
      case "retry_casual": {
        const listing = await getListingById(id);
        if (!listing) {
          await interaction.followUp({
            content: "Listing not found.",
            ephemeral: true,
          });
          return;
        }
        const profile = await getAllSettings();
        const vibe = action === "retry_formal" ? "formal" : "casual";
        const draft = await hermesDraft(listing, vibe, profile);
        await setListingDraft(id, draft.body, draft.language);
        await interaction.followUp({
          content: `🔄 New ${vibe} draft:\n\`\`\`${draft.body}\`\`\``,
        });
        break;
      }
      case "reject": {
        await updateListingStatus(id, "rejected");
        await interaction.followUp({ content: "❌ Listing rejected/skipped." });
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("❌ Bot interaction error:", err);
    await interaction
      .followUp({ content: `⚠️ Error: ${err}` })
      .catch(() => undefined);
  }
}
