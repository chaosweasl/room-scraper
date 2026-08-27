# <img src="logo.jpg" alt="KamerCatch" width="36" style="vertical-align:middle"/> KamerCatch

![KamerCatch wide logo](widelogo.jpg)

**KamerCatch** is a self-hosted housing radar for **Enschede** that watches Dutch
rental/student platforms, triages new listings with an AI gatekeeper and a commute
filter, drafts personalized inquiry emails, and lets you approve applications
straight from Discord — all from a single `docker compose up`.

---

## What it does

1. **Scrapes** Kamernet, Marktplaats, Pararius, Roomspot, and Xior on a ~15-minute
   jittered loop (single stealth-browser worker).
2. **Triages** every new listing through:
   - a **bike-commute filter** (OSRM routing to the UTwente campus),
   - **Hermes Pass 1** — a strict AI gatekeeper that rejects Dutch-only /
     no-students / Master's-only listings (`auto_rejected`),
   - **Hermes Pass 2** — an AI drafter that writes a tailored NL/EN inquiry email.
3. **Notifies** you on Discord — a simple webhook for cheap high-priority alerts,
   plus a **bot** that posts drafted listings as embeds with action buttons.
4. **Applies** with one tap — `[✅ Send Application]` drives headless Playwright to
   fill the platform contact form and submit (human-in-the-loop; `DRY_RUN` mode
   screenshots instead of sending).
5. **Manages** everything in the Next.js dashboard: a Kanban board
   (`Drafted → Applied → Rejected`), a shadow "Filtered" tab for `auto_rejected`
   listings, and a Configurator for platform toggles and dealbreakers.

---

## Tech stack

- **Worker:** Playwright + TypeScript (stealth), discord.js, libSQL client
- **Database:** SQLite (WAL mode) via Turso/libSQL
- **AI:** any OpenAI-compatible API (OpenAI / DeepSeek / Ollama / vLLM)
- **Routing:** OSRM + Nominatim (OpenStreetMap)
- **Dashboard:** Next.js 14 (App Router) + Tailwind CSS

---

## Step-by-step usage guide

### Prerequisites

- **Docker** with Docker Compose (`docker compose`) installed.
- A **Discord** server you own (for webhook + bot).
- _(Optional)_ an **OpenAI-compatible API key** for AI triage/drafting
  (OpenAI, DeepSeek, Ollama, vLLM, etc.).

---

### Step 1 — Clone and configure the environment

```bash
# 1. Clone the repo
git clone <repo-url> kamercatch
cd kamercatch

# 2. Create your environment file from the template
cp .env.example .env
```

Open [`.env`](.env.example) and fill in the values (see the inline comments in
[`.env.example`](.env.example)). The three most important ones:

| Variable              | What to put                                                     |
| --------------------- | --------------------------------------------------------------- |
| `DISCORD_WEBHOOK_URL` | A webhook URL for high-priority text alerts                     |
| `DISCORD_BOT_TOKEN`   | A bot token for the lazy-review embeds + buttons                |
| `DISCORD_CHANNEL_ID`  | The private channel where the bot posts listings                |
| `HERMES_API_KEY`      | _(optional)_ OpenAI-compatible key to enable AI triage/drafting |

> You can run without `HERMES_API_KEY` — listings will be scraped and appear in the
> dashboard, but AI drafting and the Discord draft embeds won't run.

---

### Step 2 — Set up Discord

**A. Webhook (text alerts):**

1. Open Discord → your server → **Server Settings → Integrations → Webhooks**.
2. Click **New Webhook**, give it a name (e.g. `kamercatch-alerts`), and copy the URL.
3. Paste it into `DISCORD_WEBHOOK_URL` in [`.env`](.env.example).

**B. Bot (embeds + buttons):**

1. Go to <https://discord.com/developers/applications> → **New Application** → name it
   `KamerCatch`.
2. Go to **Bot** → **Reset Token** (or **Copy**) and paste the token into
   `DISCORD_BOT_TOKEN`.
3. Under **Bot → Privileged Gateway Intents**, the app needs **Guilds** and
   **Guild Messages** intents (already requested in code).
4. Go to **OAuth2 → URL Generator**, tick the `bot` scope and the
   **Send Messages / Read Messages** permissions, and open the generated URL to invite
   the bot to your server.
5. Create a private channel (e.g. `#kamercatch`), right-click it →
   **Copy Channel ID** (enable Developer Mode in Discord settings if hidden), and
   paste it into `DISCORD_CHANNEL_ID`.

---

### Step 3 — (Optional) Set up Hermes AI

KamerCatch speaks the OpenAI chat-completions protocol, so it works with many providers:

| Provider       | `HERMES_BASE_URL`                      | `HERMES_MODEL` example |
| -------------- | -------------------------------------- | ---------------------- |
| OpenAI         | `https://api.openai.com/v1`            | `gpt-4o-mini`          |
| DeepSeek       | `https://api.deepseek.com`             | `deepseek-chat`        |
| Ollama (local) | `http://host.docker.internal:11434/v1` | `llama3.1`             |
| vLLM (local)   | `http://host.docker.internal:8000/v1`  | your model name        |

Set `HERMES_API_KEY` (for local Ollama you can use any placeholder like `ollama`).
If you leave it empty, the scraper and dashboard still work — only the AI triage and
draft generation are skipped.

---

### Step 4 — Start the stack

```bash
docker compose up --build -d
```

This builds and starts two services:

- `scraper-orchestrator` — scheduler loop + Discord bot + `/health` API.
- `frontend-dashboard` — the web UI on <http://localhost:3000>.

Check everything is healthy:

```bash
docker compose ps
curl http://localhost:8080/health
```

The first scrape cycle starts immediately; after that the loop repeats every
12–18 minutes (15 min ± random jitter).

---

### Step 5 — Configure your profile in the dashboard

1. Open <http://localhost:3000>.
2. Click **⚙️ Settings** in the top-right.
3. Adjust:
   - **Platforms** — toggle each scraper on/off (e.g. turn off Kamernet when your
     subscription expires).
   - **Dealbreakers** — language requirement, pets, minimum age, max rent.
   - **Commute** — max bike minutes to the UTwente campus.
4. Click **Save Settings**.

These values are stored in the SQLite `settings` table, so no `.env` edit or restart
is required — the worker reads them at the start of every cycle.

---

### Step 6 — Daily workflow

**A. Dashboard Kanban board**

- The **Board** tab shows four columns: `New → Drafted → Applied → Rejected`.
- Each card has quick-action buttons to move it through the pipeline
  (e.g. `Mark Drafted`, `Mark Applied`, `Reject`).
- The **Filtered** tab shows `auto_rejected` listings — review it occasionally to make
  sure the AI/commute filter isn't being too aggressive. Use **Restore** to bring a
  listing back if it was wrongly filtered.

**B. Discord lazy-review loop (the phone workflow)**

When AI is enabled, each triaged listing is posted to your Discord channel as an embed
with the draft and four buttons:

| Button                 | Action                                                         |
| ---------------------- | -------------------------------------------------------------- |
| `✅ Send Application`  | Auto-submit via headless Playwright, then set `status=applied` |
| `🔄 Retry: Too Formal` | Regenerate the draft in a formal tone                          |
| `🔄 Retry: Too Casual` | Regenerate the draft in a casual tone                          |
| `❌ Reject/Skip`       | Set `status=rejected`                                          |

**Execution modes** (set in [`.env`](.env.example)):

- `EXECUTION_MODE=manual` (default) — the Send button is hidden; copy the draft and
  apply manually.
- `EXECUTION_MODE=auto` — full button suite; tapping Send triggers the automation.
- `DRY_RUN=true` — the bot does everything except the final submit: it fills the form
  and posts a screenshot back to Discord so you can verify before going live.

> Auto-submit is human-in-the-loop: nothing is ever sent without you tapping the
> button. Platform contact forms change over time, so first-time users should run
> with `DRY_RUN=true` to confirm the flow works.

---

### Manual workflows (without the bot)

**Generate email drafts on your machine:**

```bash
# All new listings (cheapest first, capped at 15)
python generate_emails.py

# Filter by source / limit / status
python generate_emails.py --source kamernet --max 5 --status new
```

Drafts are written to `email-drafts/`. See
[`generate_emails.py`](generate_emails.py) for the `USER_NAME`/`USER_EMAIL`
placeholders at the top.

**Flag Dutch-only listings:**

```bash
python scripts/check-dutch-only.py --db data/housing.db --format table
```

This fetches each new listing and flags Dutch-only requirements.

---

### Monitoring & health

- Worker health: `http://localhost:8080/health` (per-source last count, zero-streak,
  last success).
- Discord slash command: type `/status` in the bot channel for a quick source health
  summary.
- If a source returns 0 listings for `ZERO_RESULT_ALERT_THRESHOLD` consecutive cycles
  (default 3), the bot posts a **source health alert** — a site redesign or block is
  the usual cause.

---

### Troubleshooting

| Symptom                          | Fix                                                                                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| No Discord embeds                | Check `DISCORD_BOT_TOKEN` + `DISCORD_CHANNEL_ID`, and that the bot is invited to the server         |
| Listings stay `new` (no drafts)  | `HERMES_API_KEY` is empty or invalid — check the worker logs                                        |
| Every listing is `auto_rejected` | Your `max_rent` / `max_bike_minutes_to_campus` dealbreakers are too strict (check Settings)         |
| A scraper returns 0 every cycle  | Site redesign/Cloudflare — watch for the source health alert; inspect `/app/data/*.png` screenshots |
| `SQLITE_BUSY` errors             | Shouldn't happen with WAL enabled; if it does, check the shared `./data` volume permissions         |

---

## Project structure

```
kamercatch/
├── worker/                  # TypeScript worker (scheduler + bot + scrapers)
│   ├── orchestrator.ts      # Main loop, per-source isolation, settings toggles
│   ├── bot.ts               # Discord bot (embeds + buttons)
│   ├── scraper-*.ts         # One module per platform
│   └── shared/              # db, discord, hermes, commute, triage, apply, auth…
├── dashboard/               # Next.js 14 dashboard (Kanban board + Configurator)
│   ├── app/page.tsx         # Board + shadow tab
│   ├── app/settings/        # Configurator UI
│   └── app/api/             # Status + settings endpoints
├── generate_emails.py       # Manual email-draft generator
├── scripts/check-dutch-only.py
├── docker-compose.yml       # Single worker + dashboard
├── .env.example             # Environment template
└── data/                    # SQLite volume (housing.db)
```

## License

MIT
