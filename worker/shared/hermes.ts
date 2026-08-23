import { Listing } from "./db";

const BASE_URL = (
  process.env.HERMES_BASE_URL || "https://api.openai.com/v1"
).replace(/\/$/, "");
const API_KEY = process.env.HERMES_API_KEY || "";
const MODEL = process.env.HERMES_MODEL || "gpt-4o-mini";

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Minimal OpenAI-compatible chat completion. Works with OpenAI, DeepSeek,
 * Ollama, vLLM, etc. by pointing HERMES_BASE_URL + HERMES_API_KEY + HERMES_MODEL.
 */
export async function hermesComplete(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 600,
): Promise<string> {
  if (!API_KEY) {
    throw new Error("HERMES_API_KEY not configured");
  }

  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4,
      max_tokens: maxTokens,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Hermes HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data = (await resp.json()) as ChatResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/**
 * Hermes Pass 1 — the gatekeeper.
 *
 * The prompt asks whether the listing *explicitly* hits a dealbreaker. When the
 * model answers YES (it DOES require Dutch / prohibit students / demand a
 * Master's/PhD), the listing is rejected. NO means it passes the gate.
 */
export async function hermesGatekeeper(
  listing: Listing,
  profile: Record<string, string>,
): Promise<{ pass: boolean; reason: string }> {
  const text = [
    listing.title,
    listing.listing_type || "",
    listing.description || "",
  ]
    .filter(Boolean)
    .join("\n")
    .slice(0, 3000);

  const user = [
    "You are a strict filtering agent.",
    "The user is a non-Dutch speaker, has no pets, and is an undergraduate (Bachelor) student.",
    `Profile dealbreakers: language=${profile.lang_req || "english_allowed"}, pets=${profile.pets || "no_pets_allowed"}, min_age=${profile.min_age || "19"}.`,
    "Read this listing:",
    "---",
    text,
    "---",
    "Does it explicitly require a Dutch speaker, prohibit students, or demand a Master's/PhD? Answer only YES or NO, followed by a one-sentence reason.",
  ].join("\n");

  const reply = await hermesComplete(
    "You are a strict filtering agent for housing listings. Answer only YES or NO, followed by a one-sentence reason.",
    user,
    120,
  );

  const firstLine = reply.split("\n")[0].trim().toUpperCase();
  // YES = the listing has an explicit dealbreaker → do not pass.
  const pass = !firstLine.startsWith("YES");
  const reason = reply.replace(/^(YES|NO)[\s,:-]*/i, "").trim();
  return { pass, reason: reason || reply };
}

/**
 * Hermes Pass 2 — the drafter.
 */
export async function hermesDraft(
  listing: Listing,
  vibe: "auto" | "formal" | "casual",
  profile: Record<string, string>,
): Promise<{ body: string; language: string }> {
  const dutchSources = ["marktplaats", "roomspot", "pararius", "kamernet"];
  const language = dutchSources.includes(listing.source) ? "nl" : "en";

  const toneHint =
    vibe === "formal"
      ? "Use a formal, polite tone."
      : vibe === "casual"
        ? "Use a casual, friendly student tone."
        : "Match the tone of the listing (student house vs. formal agency).";

  const user = [
    "Write a short, personalized housing-inquiry email draft for the listing below.",
    `User profile: name=${profile.user_name || "the tenant"}, email=${profile.user_email || ""}, non-Dutch speaker, no pets, undergraduate student at University of Twente.`,
    `Write in ${language === "nl" ? "Dutch" : "English"}.`,
    toneHint,
    "Address the landlord by name if one is visible, otherwise use a polite generic greeting.",
    "Keep it under 150 words and do not invent facts.",
    "Return ONLY the email body text.",
    "---",
    `Title: ${listing.title}`,
    `Address: ${listing.address || ""}`,
    `Rent: €${listing.rent}/month`,
    `Type: ${listing.listing_type || ""}`,
    `Description: ${listing.description || ""}`,
  ].join("\n");

  const body = await hermesComplete(
    "You are an expert at writing effective, polite housing-inquiry emails.",
    user,
    500,
  );
  return { body, language };
}
