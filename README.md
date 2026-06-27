# 🏠 Room Scraper — Housing Radar for Enschede

A multi-source housing scraper that monitors Dutch rental platforms for listings in
**Enschede**, stores them in a SQLite database, and provides a real-time dashboard
plus automated email draft generation.

## Supported Platforms

| Source        | Type          | Login Required |
|---------------|---------------|----------------|
| **Roomspot**  | Student housing | No           |
| **Marktplaats** | Classifieds | No            |
| **Pararius**  | Rental aggregator | No          |
| **Xior**       | Student housing | No           |
| **Kamernet**  | Student rooms  | Yes (optional) |

## Tech Stack

- **Scrapers:** Playwright + TypeScript (stealth mode, anti-detection)
- **Database:** SQLite via Turso/libSQL client
- **Dashboard:** Next.js 14 (App Router)
- **Infrastructure:** Docker Compose
- **Notifications:** Discord webhook alerts for high-priority listings
- **Email Drafts:** Python script that queries the DB and generates personalized
  Dutch/English email templates

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Docker Compose                                         │
│                                                         │
│  ┌──────────────────┐  ┌──────────────────┐             │
│  │ orchestrator     │  │ roomspot         │             │
│  │ (all 5 scrapers) │  │ (standalone)     │             │
│  │ Marktplaats      │  │ Roomspot         │             │
│  │ Pararius         │  │                  │             │
│  │ Xior             │  └────────┬─────────┘             │
│  │ Kamernet         │           │                       │
│  └────────┬─────────┘           │                       │
│           │                     │                       │
│           ▼                     ▼                       │
│  ┌───────────────────────────────────────┐              │
│  │           housing.db (SQLite)         │              │
│  └───────────────┬───────────────────────┘              │
│                  │                                      │
│     ┌────────────┼────────────┐                         │
│     ▼            │            ▼                         │
│  ┌────────┐      │      ┌──────────────┐                │
│  │Next.js │      │      │generate_     │                │
│  │Dashboard│     │      │emails.py     │                │
│  │(:3000) │      │      │→ email-drafts│                │
│  └────────┘      │      └──────────────┘                │
│                  │                                      │
│                  ▼                                      │
│         Discord Webhook                                 │
│         (high-priority alerts)                          │
└─────────────────────────────────────────────────────────┘
```

Each scraper runs on a ~15-minute cycle with random jitter to avoid detection.
New listings under €500 trigger an instant Discord alert.

## Quick Start

```bash
# 1. Clone the repo
git clone https://github.com/YOUR_USERNAME/room-scraper.git
cd room-scraper

# 2. Configure environment
cp .env.example .env
# Edit .env and fill in your credentials:
#   DISCORD_WEBHOOK_URL  — Discord webhook for alerts (optional)
#   KAMERNET_EMAIL       — Kamernet login email (optional)
#   KAMERNET_PASSWORD    — Kamernet login password (optional)

# 3. Start all services
docker-compose up --build -d

# 4. View the dashboard
open http://localhost:3000
```

## Manual Email Generation

After scrapers have collected listings, generate personalized email drafts:

```bash
# Install dependencies (Python 3.10+)
pip install -r requirements.txt  # if you have one, or just use stdlib

# Generate drafts for all new listings
python generate_emails.py

# Filter by source, status, or limit
python generate_emails.py --source kamernet --max 5 --status new
```

Drafts are written to `email-drafts/` — open them, fill in the landlord's
contact info, and send.

> ⚠️ **Important:** Edit `USER_NAME` and `USER_EMAIL` in `generate_emails.py`
> before using it. The template bodies should also be customized.

## Project Structure

```
room-scraper/
├── worker/                     # TypeScript scrapers
│   ├── orchestrator.ts         # Runs all scrapers sequentially
│   ├── index.ts                # Standalone Roomspot scraper
│   ├── scraper-roomspot.ts     # Roomspot (orchestrated)
│   ├── scraper-marktplaats.ts  # Marktplaats
│   ├── scraper-pararius.ts     # Pararius
│   ├── scraper-xior.ts         # Xior
│   ├── scraper-kamernet.ts     # Kamernet (with login/cookie support)
│   ├── shared/
│   │   ├── db.ts               # SQLite schema & insert helpers
│   │   └── discord.ts          # Discord webhook notifications
│   ├── Dockerfile
│   ├── package.json
│   └── tsconfig.json
├── dashboard/                  # Next.js dashboard app
│   ├── app/
│   ├── Dockerfile
│   └── package.json
├── data/                       # Mounted volume — housing.db lives here
├── email-drafts/               # Generated email drafts (gitignored)
├── generate_emails.py          # Email draft generator
├── docker-compose.yml          # Service orchestration
├── .env.example                # Environment variable template
└── .gitignore
```

## License

MIT