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
  getSetting,
  markListingApplied,
  setListingDraft,
  updateListingStatus,
} from "./shared/db";
import { renderListingDraft, draftLanguage } from "./shared/templates";
import { submitApplication } from "./shared/apply";
import { getStats } from "./shared/monitor";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;

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

async function buildButtons(listingId: string) {
  const applyMode = (await getSetting("apply_mode")) || "off";
  const row = new ActionRowBuilder<ButtonBuilder>();

  if (applyMode === "review" || applyMode === "auto") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`send:${listingId}`)
        .setLabel(
          applyMode === "review"
            ? "🧪 Test Application"
            : "✅ Send Application",
        )
        .setStyle(
          applyMode === "review" ? ButtonStyle.Primary : ButtonStyle.Success,
        ),
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`formal:${listingId}`)
      .setLabel("🔄 Formal template")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`casual:${listingId}`)
      .setLabel("🔄 Casual template")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`reject:${listingId}`)
      .setLabel("❌ Reject/Skip")
      .setStyle(ButtonStyle.Danger),
  );

  return row;
}

/**
 * Post a drafted listing to the configured Discord channel. When applying is
 * off, only the draft + template buttons are shown; otherwise a Send/Test
 * button is included.
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

    if (listing.distance_minutes != null) {
      embed.addFields({
        name: "Distance",
        value: `${listing.distance_minutes} min ${listing.distance_mode === "walking" ? "walking" : "cycling"}`,
        inline: true,
      });
    }

    embed.addFields({
      name: "✉️ Draft",
      value: listing.draft_body.slice(0, 1024),
    });

    const components = [await buildButtons(id)];
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
        const applyMode = (await getSetting("apply_mode")) || "off";
        if (applyMode === "off") {
          await interaction.followUp({
            content:
              "Sending is off. Copy the draft and apply manually, or change Apply mode in the dashboard.",
            ephemeral: true,
          });
          return;
        }

        const listing = await getListingById(id);
        if (!listing) {
          await interaction.followUp({
            content: "Listing not found.",
            ephemeral: true,
          });
          return;
        }

        const dryRun = applyMode === "review";
        const result = await submitApplication(listing, { dryRun });
        if (result.screenshotPath) {
          await interaction.followUp({
            content: "🧪 **TEST MODE** — form filled but NOT submitted:",
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
      case "formal":
      case "casual": {
        const listing = await getListingById(id);
        if (!listing) {
          await interaction.followUp({
            content: "Listing not found.",
            ephemeral: true,
          });
          return;
        }
        const settings = await getAllSettings();
        const template =
          action === "formal"
            ? settings.template_landlord
            : settings.template_cooptation;
        const body = renderListingDraft(
          {
            listing,
            userName: settings.user_name || "",
            userEmail: settings.user_email || "",
          },
          template,
        );
        await setListingDraft(id, body, draftLanguage(listing));
        await interaction.followUp({
          content: `🔄 New draft:\n\`\`\`${body}\`\`\``,
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
