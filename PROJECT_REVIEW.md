# 🏠 Room Scraper — Project Overview, Logic Flow & Review

> A technical walkthrough of how this project works, its intended purpose, and a
> critical review of things that can fail, bugs, manual-work pain points, and
> optimization opportunities.

---

## 1. What This Project Is (Intended Use & Goal)

**Goal:** Automatically monitor Dutch rental/student-housing platforms for listings in
**Enschede** (specifically targeting the University of Twente / Saxion crowd), collect them
in one place, alert the user instantly when something cheap appears, and help draft
personalized inquiry emails.

**Intended use (daily workflow):**

1. A scraper worker runs on a ~15-minute loop and watches 5 platforms.
2. New/cheap listings are saved to a SQLite database and pushed to a Discord webhook.
3. The user browses everything on a local Next.js dashboard (`localhost:3000`).
4. The user runs a Python script to auto-generate personalized email drafts for the
   cheapest/newest listings, then manually opens each listing, finds the landlord's
   contact, and sends the email.

**Non-goals (by design):** no auto-sending of emails (avoids spam), no login automation for
most platforms, no paid subscription scraping.

---

## 2. Architecture Overview

```
┌────────────────────────── Docker Compose ──────────────────────────┐
│                                                                   │
│  scraper-orchestrator ──────────┐   scraper-roomspot (standalone)  │
│  (kamernet, marktplaats,        │   (index.ts — Roomspot AGAIN)    │
│   pararius, roomspot)           │                                  │
│        │                        │                                  │
│        │  Playwright (stealth)  │                                  │
│        ▼                        ▼                                  │
│  ┌─────────────────────────────────────┐                           │
│  │  ./data/housing.db  (SQLite,        │  ← shared bind mount      │
│  │   mounted into ALL 3 containers)    │                           │
│  └───────────────┬─────────────────────┘                           │
│                  │                                                │
│     ┌────────────┼────────────┐                                    │
│     ▼            │            ▼                                    │
│  frontend-    Discord       generate_emails.py                     │
│  dashboard    webhook       (manual run on host)                   │
│  (:3000)      (alerts)      → email-drafts/*.md                    │
└────────────────────────────────────────────────────────────────────┘
```

**Components and their roles:**

| Component                  | Files                                                                                                                                                                                                                                                                                                    | Role                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Orchestrator worker        | [`worker/orchestrator.ts`](worker/orchestrator.ts)                                                                                                                                                                                                                                                       | Runs 4 scrapers sequentially in one stealth browser, loops every ~15 min |
| Standalone Roomspot worker | [`worker/index.ts`](worker/index.ts)                                                                                                                                                                                                                                                                     | Second, _duplicate_ Roomspot scraper running in its own container        |
| Scrapers                   | [`worker/scraper-kamernet.ts`](worker/scraper-kamernet.ts), [`worker/scraper-marktplaats.ts`](worker/scraper-marktplaats.ts), [`worker/scraper-pararius.ts`](worker/scraper-pararius.ts), [`worker/scraper-roomspot.ts`](worker/scraper-roomspot.ts), [`worker/scraper-xior.ts`](worker/scraper-xior.ts) | One module per platform, each extracts listings & inserts into SQLite    |
| DB layer                   | [`worker/shared/db.ts`](worker/shared/db.ts)                                                                                                                                                                                                                                                             | Schema creation + dedup insert helper                                    |
| Notifications              | [`worker/shared/discord.ts`](worker/shared/discord.ts)                                                                                                                                                                                                                                                   | Sends webhook alerts for high-priority listings                          |
| Dashboard                  | [`dashboard/app/page.tsx`](dashboard/app/page.tsx)                                                                                                                                                                                                                                                       | Next.js read-only UI over the SQLite DB                                  |
| Email drafts               | [`generate_emails.py`](generate_emails.py)                                                                                                                                                                                                                                                               | Manual script; generates personalized NL/EN email drafts                 |
| Dutch-only filter          | [`scripts/check-dutch-only.py`](scripts/check-dutch-only.py)                                                                                                                                                                                                                                             | Flags listings that require Dutch only                                   |
| Legacy Xior checker        | [`worker/xior_check.py`](worker/xior_check.py)                                                                                                                                                                                                                                                           | Standalone Windows Selenium script (not in Docker)                       |

---

## 3. Step-by-Step Logic Flow

### 3.1 Container startup (Docker Compose)

1. [`docker-compose.yml`](docker-compose.yml) builds the worker image from
   [`worker/Dockerfile`](worker/Dockerfile) (Playwright `v1.60.0-noble` base) and the
   dashboard from [`dashboard/Dockerfile`](dashboard/Dockerfile).
2. Three services start: `scraper-orchestrator`, `scraper-roomspot`, `frontend-dashboard`.
3. All three mount the host `./data` folder at `/app/data`; the SQLite file lives there.
4. Workers get `ipc: host` (required for Chrome subprocess IPC in Docker).

### 3.2 The scheduler loop (both workers)

1. On start, the engine runs a full scrape cycle immediately, then waits and repeats.
2. Delay = `15 min` base + random jitter in range **-3 min .. +3 min** (resulting in a
   12–18 min cycle) to look less like a bot — see [`worker/orchestrator.ts`](worker/orchestrator.ts:50).
3. The loop uses `setTimeout`, so a cycle only starts after the previous one **finished** —
   there is no overlap within a single container.

### 3.3 Orchestrator scrape cycle

1. `ensureSchema()` creates/patches the `listings` table — [`worker/shared/db.ts`](worker/shared/db.ts:7).
2. One stealth browser is launched with `--no-sandbox`, `--disable-dev-shm-usage`, etc.
3. Scrapers run **sequentially**, sharing that one browser:
   - **Kamernet** (fetch-based, no browser): pages 1..15 of the Enschede room results,
     parses `__NEXT_DATA__` JSON, filters `rent <= €750`, inserts — [`worker/scraper-kamernet.ts`](worker/scraper-kamernet.ts:100).
   - **Marktplaats**: loads the "kamers te huur" search, clicks cookies, scrapes
     `li.hz-Listing` items, parses price/location/type, skips some syndicated junk — [`worker/scraper-marktplaats.ts`](worker/scraper-marktplaats.ts:24).
   - **Pararius**: loads the Enschede rental search, waits out Cloudflare, tries several
     listing selectors, extracts listings — [`worker/scraper-pararius.ts`](worker/scraper-pararius.ts:27).
   - **Roomspot**: loads `/en/housing-offer/to-rent`, dismisses cookie banner, scrapes
     `section.list-item` — [`worker/scraper-roomspot.ts`](worker/scraper-roomspot.ts:7).
   - **Xior**: ⚠️ _Not called here at all_ (see Review §4.2).
4. Each listing goes through `insertListing()`:
   - SELECT by `id` → if it exists, skip (dedup).
   - Otherwise INSERT with `status='new'`, `date_found`, and a `priority` (high/normal).
5. If the insert was new **and** the rent is cheap (≤ €500, or ≤ €400/€500 on Kamernet),
   a Discord alert is fired via [`worker/shared/discord.ts`](worker/shared/discord.ts).
6. The browser is closed in `finally`; totals are logged; the scheduler waits ~12–18 min.

### 3.4 Standalone Roomspot worker

- [`worker/index.ts`](worker/index.ts) does essentially the _same_ Roomspot scrape, with its
  own browser and its own 15-min jitter loop, writing to the **same** SQLite file.
- This is a leftover from before the orchestrator existed and is now redundant (see §4.3).

### 3.5 Dashboard

1. Next.js renders the page server-side on every request (`force-dynamic`) — [`dashboard/app/page.tsx`](dashboard/app/page.tsx:20).
2. It opens the SQLite DB directly (`file:/app/data/housing.db`) and `SELECT * FROM listings`.
3. Filtering/sorting happens **in JavaScript** on the server (source, type, priority,
   price range, text search, rent/date/priority sort).
4. The UI shows stats, filter controls, and listing cards with a link to each listing.

### 3.6 Manual email-draft workflow

1. User runs `python generate_emails.py` (optionally `--source`, `--max`, `--status`).
2. It queries listings with `status='new'`, ordered by priority then rent, capped at 15.
3. For each listing it writes a combined `housing-emails-<timestamp>.md` plus individual
   draft files into `email-drafts/` — [`generate_emails.py`](generate_emails.py:350).
4. Each draft contains contact guidance per platform, a NL (Dutch platforms) or EN body,
   a subject line, and a quick-actions checklist.
5. **Manual steps remain:** open listing → find landlord contact → fill in "To:" → send.
6. Nothing ever changes the listing `status` from `new`, so the same drafts keep being
   regenerated on later runs (capped at 15 per run).

### 3.7 Dutch-only check (manual / separate)

- [`scripts/check-dutch-only.py`](scripts/check-dutch-only.py) reads `status='new'` listings,
  fetches each detail page (rate-limited, ~0.8s apart), and flags Dutch-only listings using
  Kamernet's structured language data or regex text signals.
- It is **not wired into any scheduler** in this repo (see §4.6).

---

## 4. Review — Things That Can Fail or Don't Work Properly

### 4.1 🔴 Bugs (code definitely does the wrong thing)

| #   | Location                                                                                                           | Problem                                                                                                                                                                                                                                                                                                                                | Impact                                                                      |
| --- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| B1  | [`worker/scraper-roomspot.ts`](worker/scraper-roomspot.ts:75)                                                      | Priority is `item.cleanPrice <= 500 ? 'high' : 'normal'` with **no `> 0` guard**. A listing with an unparseable/zero price (parse fallback `0`) gets flagged **high priority and triggers a Discord alert** with `€0`. The other Roomspot scraper ([`worker/index.ts`](worker/index.ts:96)) does have the `> 0` guard — they disagree. | False-positive "URGENT" alerts & spam; confusing €0 listings.               |
| B2  | [`worker/scraper-marktplaats.ts`](worker/scraper-marktplaats.ts:69) vs [`:124`](worker/scraper-marktplaats.ts:124) | The URL-cleaning code **strips** `?c=` and `casData=` params, but the "skip huurwoningen redirect" check right after tests `item.url.includes('?c=') && item.url.includes('casData=')`. Since both params were already removed, the condition is **always false** — the paywalled huurwoningen.nl listings are **never skipped**.      | Dead filter; paywalled/redirect listings still get inserted & emailed.      |
| B3  | [`generate_emails.py`](generate_emails.py:187)                                                                     | `needs_manual_contact()` checks `source == 'marktplatz'` — **typo**; the real source value is `'marktplaats'`. The paywall warning never appears in drafts.                                                                                                                                                                            | Users never get warned about subscription-only Marktplaats redirects.       |
| B4  | [`worker/scraper-marktplaats.ts`](worker/scraper-marktplaats.ts:139)                                               | When no Marktplaats ID is found, the fallback id is `r-` + **`Math.random()`** → the same listing gets a **new random ID every cycle** → it's re-inserted as "NEW" every 15 min and re-alerted.                                                                                                                                        | Duplicate rows + duplicate Discord spam for listings without parseable IDs. |
| B5  | [`worker/scraper-pararius.ts`](worker/scraper-pararius.ts:122)                                                     | ID = base64 of the **first 32 chars** of the URL. Two listings whose URLs share the first 32 characters collide → the second is silently dropped as a "duplicate".                                                                                                                                                                     | Missed listings (low likelihood, but real).                                 |
| B6  | [`worker/shared/discord.ts`](worker/shared/discord.ts:16)                                                          | Emoji logic `listing.priority === 'high' ? '🔴 URGENT' : '🟡'` — the 🟡 is used as a **label prefix**, not just an emoji, so normal alerts read `🟡 **NEW ... LISTING!**`; cosmetic only.                                                                                                                                              | Cosmetic.                                                                   |
| B7  | [`generate_emails.py`](generate_emails.py:410)                                                                     | Individual draft filenames are sanitized **truncated titles**; two listings with the same first ~50 chars **overwrite each other's file**.                                                                                                                                                                                             | Lost drafts.                                                                |

### 4.2 🔴 Dead / unwired code (features that don't actually run)

| #   | Location                                                     | Problem                                                                                                                                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | [`worker/scraper-xior.ts`](worker/scraper-xior.ts:12)        | `checkXiorAvailability()` is **never imported or called** anywhere — Xior is listed as a supported platform and the README says the orchestrator runs "all 5 scrapers", but the orchestrator only calls Kamernet, Marktplaats, Pararius, Roomspot ([`worker/orchestrator.ts`](worker/orchestrator.ts:32)). Xior is fully dead code in Docker. |
| D2  | [`worker/xior_check.py`](worker/xior_check.py)               | A separate Selenium script with **hard-coded Windows paths** (`C:\Program Files\Google\Chrome\...`, `C:\Users\virtu\...`) and a pinned `version_main=149`. It's not in Docker Compose and references another user's home dir. Only runnable manually on a specific Windows machine.                                                           |
| D3  | `KAMERNET_EMAIL` / `KAMERNET_PASSWORD`                       | Passed in [`docker-compose.yml`](docker-compose.yml:13) but **never read** by [`worker/scraper-kamernet.ts`](worker/scraper-kamernet.ts) — the scraper uses anonymous `fetch()` with no login. The README claims "login/cookie support" that doesn't exist.                                                                                   |
| D4  | [`scripts/check-dutch-only.py`](scripts/check-dutch-only.py) | Docstring says "The cron uses this to filter…" but **no cron/scheduler exists** in the repo. The script is effectively a one-off manual tool.                                                                                                                                                                                                 |

### 4.3 🟠 Redundancy & resource waste

- **Roomspot is scraped twice** — by the orchestrator and by the standalone
  [`worker/index.ts`](worker/index.ts) container. Both run on ~15-min loops and both write
  to the same SQLite file. This doubles traffic to Roomspot (raises ban risk), wastes
  ~1 browser instance 24/7, and creates **concurrent SQLite writes** from two processes.
- **Risk:** SQLite is fine for multi-process _reads_, but concurrent _writes_ from two
  containers on a shared bind mount can hit `SQLITE_BUSY` / `database is locked` errors,
  especially since both cycles can overlap. There is no `busy_timeout` / WAL configured in
  [`worker/shared/db.ts`](worker/shared/db.ts).

### 4.4 🟠 One scraper failure kills the whole cycle

- In [`worker/orchestrator.ts`](worker/orchestrator.ts:30), all four scraper calls are in a
  **single try/catch**. If any scraper throws (e.g., a Playwright launch/selector error that
  escapes the internal catches), the remaining scrapers are skipped for that cycle. Each
  scraper has internal try/catch so a full abort is unlikely, but it's one missed guard away
  from a "silent half-empty cycle".

### 4.5 🟠 Silent failures & no monitoring

- Scrapers log "0 listings found" and move on; a site redesign (DOM/class change) makes a
  scraper return 0 **every cycle with no alert**. Nothing notifies the user that a source
  is broken. The only diagnosis aid is a screenshot written to `/app/data/`.
- **Brittle selectors everywhere:** `section.list-item`, `li.hz-Listing`,
  `listing-search-item`, `#challenge-running`, `__NEXT_DATA__` JSON shape. These are
  unversioned contracts with third-party sites; any layout change silently breaks a source.
- Cloudflare challenges (Pararius/Xior) are handled heuristically; a harder challenge means
  the scraper just extracts nothing.
- No retry/backoff, no per-source health metric, no alert on sustained 0 results.

### 4.6 🟠 Coverage gaps (missed listings)

- **Marktplaats only scrapes page 1** — pagination is an explicit TODO stub
  ([`worker/scraper-marktplaats.ts`](worker/scraper-marktplaats.ts:179)). It can miss most
  listings depending on how many fit on page 1.
- **Xior never runs** in Docker (see D1).
- Roomspot scraper only reads the first results page too (no pagination).
- Kamernet is capped at 15 pages and breaks early after page 5 if a page is empty, which is
  fine — but it fetches with plain `fetch()` + a generic UA; Kamernet could serve a
  different/blocked page to non-browser requests over time.

### 4.7 🟡 Scheduling / correctness details

- Jitter math is safe (never negative: 15 min ± 3 min ⇒ 12–18 min) — good.
- `date_found` is ISO-8601 UTC; sorting `date_found DESC` lexicographically is correct. Good.
- `ensureSchema()` re-runs `ALTER TABLE ... ADD COLUMN` every cycle and swallows errors;
  works, but it's a homegrown migration hack — a future schema change (e.g., NOT NULL,
  UNIQUE, index) is awkward here.
- Two separate `startEngine()` jitter loops (orchestrator + standalone roomspot) are
  independent, which is precisely what causes the concurrent-write window.

### 4.8 🟡 Docker & config issues

- [`README.md`](README.md:72) references **`.env.example` which does not exist** in the repo
  (confirmed via file listing). Users must hand-craft env vars or rely on Compose
  placeholders.
- `npm install` (not `npm ci`) is used in both Dockerfiles — non-reproducible builds even
  though `package-lock.json` files exist.
- Worker runs via `npx ts-node` at runtime with devDependencies installed — slow startup and
  ships TypeScript + toolchain into the image. Better: compile once (`tsc`) and run JS.
- [`worker/index.ts`](worker/index.ts:18) launches Chromium **without** `--no-sandbox`, while
  the orchestrator and Xior do include it. In the Playwright Docker image running as root,
  Chromium can refuse to start without `--no-sandbox` → the standalone Roomspot container
  may crash-loop. This is a real inconsistency.
- `depends_on` in Compose is essentially meaningless here (no separate DB service; both
  workers just read the shared file).
- No healthchecks on any service; `restart: always` means a crash-looping scraper burns
  resources silently.

### 4.9 🟡 Manual-work pain points (by design but costly)

1. **Email sending is fully manual**: per listing you must open the site, find the
   landlord's email/phone, paste the draft, and send. No CRM/status tracking — nothing
   marks a listing as "applied", so `status='new'` never clears.
2. **Drafts regenerate endlessly**: since status never changes, every run of
   `generate_emails.py` re-generates the same 15 cheapest `new` listings. No way to say
   "I already emailed this one."
3. **Placeholders to edit by hand**: `USER_NAME` / `USER_EMAIL` in
   [`generate_emails.py`](generate_emails.py:24) must be edited; templates are hard-coded.
4. **Dashboard is read-only**: no UI to mark applied/rejected, add notes, or delete junk —
   DB edits are manual (`sqlite3`) or not possible.
5. **Xior** requires a separate Windows-only Python/Selenium run with hard-coded paths (D2).

### 4.10 🟡 Security & robustness

- [`scripts/check-dutch-only.py`](scripts/check-dutch-only.py:166) disables SSL certificate
  verification (`ssl.CERT_NONE`) — a MITM risk on fetched listing pages.
- Discord webhook is protected against the default placeholder (good), but there's **no
  rate limiting** — a Kamernet burst of cheap listings → many rapid webhook calls.
- `INTERNATIONAL_PATTERNS` includes the very broad `r'[Ii]nternationals?\b'`
  ([`scripts/check-dutch-only.py`](scripts/check-dutch-only.py:140)) — any page mentioning
  "international" overrides Dutch-only detection, likely producing false negatives.
- Listing URLs are inserted from scraped HTML and rendered as `href` on the dashboard —
  sanitized with `rel="noopener noreferrer"`, so risk is low, but no URL validation exists.

---

## 5. Optimization Opportunities

**Correctness first (fixes for §4.1 / §4.2):**

1. Add the `> 0` guard in [`worker/scraper-roomspot.ts`](worker/scraper-roomspot.ts:75) to match `index.ts`.
2. Move the Marktplaats huurwoningen skip **before** URL param-stripping, or check against
   the raw `relUrl` (fix B2).
3. Fix the `marktplatz` → `marktplaats` typo in [`generate_emails.py`](generate_emails.py:187) (fix B3).
4. Replace the `Math.random()` fallback ID in Marktplaats with a stable hash of the URL
   (fix B4), and make the Pararius ID a full-length hash instead of a 32-char truncation
   (fix B5).
5. Either **wire Xior into the orchestrator** (and add Xvfb to the worker image for the
   headed launch) or delete the dead Xior code and remove Xior from the README/platform list.

**Architecture / reliability:** 6. **Remove the duplicate Roomspot service** — keep Roomspot in the orchestrator only, or
keep `index.ts` only. This halves traffic, frees a browser, and removes concurrent-write
risk. If both must run, enable WAL + `busy_timeout` in [`worker/shared/db.ts`](worker/shared/db.ts). 7. **Isolate scrapers** with per-source try/catch so one failure can't skip the rest. 8. **Add monitoring:** track per-source `last_success_at` / `last_count`; alert (Discord) if
a source returns 0 for N consecutive cycles. Add a simple `/health` that reports counts. 9. **Add retry with backoff** for transient failures and Cloudflare waits. 10. **Implement Marktplaats pagination** (the TODO already hints at it) and add Roomspot
pagination; both directly increase coverage. 11. **Make the ID schema consistent**: e.g., `hash(url)` across all sources — simpler dedup,
no platform-specific prefixes.

**Performance / efficiency:** 12. Run the Kamernet fetch-based scraper **in parallel** with the browser-based ones (it
doesn't use the shared browser) to cut cycle latency; keep the others sequential to
avoid rate-limit spikes. 13. Use `INSERT ... ON CONFLICT(id) DO NOTHING` + check `changes` instead of SELECT-then-
INSERT to halve DB round-trips per listing. 14. Dashboard: push filters into SQL (`WHERE`) instead of `SELECT *` + JS filtering; add an
index on `(status, priority, rent)`. Fine at small scale, but it scales the DB work. 15. Compile TypeScript (`tsc`) in the Docker build and run `node dist/*.js`; use `npm ci`. 16. Add `.env.example` (it's referenced but missing) and document the env vars.

**Manual-work reduction (biggest day-to-day win):** 17. Add a `status` toggle (new → applied/rejected) in the dashboard, so `generate_emails.py`
stops re-drafting already-contacted listings. 18. Track `emailed_at` / `last_draft` per listing and let the script skip or de-duplicate. 19. Make `USER_NAME`/`USER_EMAIL` env-var driven instead of file-edited. 20. Add a `--send` mailto integration (open pre-filled `mailto:` links) to cut copy-paste
work without auto-sending.

---

## 6. Prioritized Action List

| Priority | Action                                                     | Reason                                |
| -------- | ---------------------------------------------------------- | ------------------------------------- |
| 🔴 P0    | Fix Roomspot zero-price high-priority bug (B1)             | False urgent alerts, alert spam       |
| 🔴 P0    | Fix Marktplaats huurwoningen skip (B2) + typo (B3)         | Paywalled junk reaches inbox          |
| 🔴 P0    | Fix random-ID duplicate re-inserts (B4)                    | Duplicate rows + alert spam           |
| 🔴 P0    | Decide Xior: wire it in or remove it (D1)                  | README/platform mismatch, dead code   |
| 🟠 P1    | Remove duplicate Roomspot service (O6)                     | Traffic, resources, SQLite contention |
| 🟠 P1    | Per-source error isolation + 0-result alerting (O7, O8)    | Silent failures currently invisible   |
| 🟠 P1    | `.env.example` + `npm ci` + compile TS (O15, O16)          | Reproducibility, setup friction       |
| 🟠 P1    | Marktplaats/Roomspot pagination (O10)                      | Missed listings                       |
| 🟡 P2    | Status/`emailed_at` tracking + dashboard toggle (O17, O18) | Biggest manual-work reduction         |
| 🟡 P2    | Add `--no-sandbox` to `index.ts` launch (4.8)              | Standalone container may crash        |
| 🟡 P2    | WAL + busy_timeout if keeping two writers (O6)             | SQLite lock safety                    |
| 🟡 P2    | Push dashboard filters into SQL (O14)                      | Scalability                           |

---

## 7. Summary

This is a well-intentioned, working single-user housing radar with a clear goal: never miss
a cheap room in Enschede. The core loop (scrape → dedup → DB → dashboard/Discord → manual
email drafts) is sound and the anti-ban jitter is a nice touch. The main weaknesses are:

- **Dead code and platform mismatch**: Xior is advertised but never runs; Kamernet login
  env vars are passed but unused; `.env.example` is referenced but missing.
- **A handful of real bugs** around price guards, a dead Marktplaats filter, a typo, and
  random-ID duplicates that can produce false alerts and repeated rows.
- **Redundant architecture** (Roomspot scraped twice from two containers writing to one
  SQLite file) with a real concurrency risk.
- **Silent failure mode** — brittle third-party selectors with no monitoring or
  "source stopped returning data" alerting.
- **Heavy manual workflow** — manual sending, no status tracking, regenerated drafts.

None of this is fatal; the project works as a personal tool. Addressing the P0 list first
(~1 hour of edits) removes the false-alert and duplicate bugs, and adding status tracking
(P1/P2) would cut the day-to-day manual effort more than anything else.

project should be renamed to KamerCatch with a crow logo. logo can be found in the repo root. make sure to integrate it app-wide (wide logo is a bigger version of the logo thats wide) you can move them as you want

other advice i found u should follow:

Phase 1: The Foundation & Bug Squashing
Before adding the AI and UI magic, the core engine needs to be bulletproof so it stops dropping listings and wasting resources.

Kill the Duplicates: Delete the standalone worker/index.ts (Roomspot) container. Move everything into the main orchestrator.ts loop to free up memory and prevent SQLite write clashes.

Isolate Scraper Failures: Wrap each scraper call in the orchestrator with its own try/catch. If Pararius changes its HTML and crashes, Marktplaats and Roomspot must continue running.

Fix the Data Bugs:

Add a > 0 guard to Roomspot so unparsed €0 listings don't trigger "URGENT" alerts.

Replace Marktplaats's Math.random() ID with a stable hash(url) so the same room doesn’t get inserted every 15 minutes.

Implement Lazy Authentication: For platforms like Roomspot, write a Playwright helper that checks for a logged-in state. If the session has expired, it automatically grabs credentials from the .env file, fills the login form, and continues scraping.

Phase 2: Database Evolution & Profile Configuration
To support the triage system and interactive UI, the SQLite database needs a structural upgrade. Enable WAL (Write-Ahead Logging) mode so the orchestrator can write while the Next.js dashboard reads simultaneously.

Expand the schema with two new tables/columns:

Listings Table Update: Add a status column with strictly defined states: new, drafted, applied, rejected, and auto_rejected (the shadow state).

Settings/Profile Table: A key-value table to hold the user's hard limits and toggles.

Platform Toggles: scraper_kamernet: false, scraper_roomspot: true.

Dealbreakers: lang_req: english_allowed, pets: no_pets_allowed, min_age: 19, max_rent: 600.

Commute Rules: max_bike_minutes_to_campus: 20.

Phase 3: The AI Triage & Commute Engine
This is where the manual work drops to zero. The orchestrator intercepts the scraped data before it ever hits your screen.

Distance Filtering First: Run the listing's location through a lightweight routing API (like OSRM or Google Maps Distance Matrix). If the bike ride to the UTwente campus is 35 minutes and the profile limit is 20, immediately set the status to auto_rejected.

Hermes Pass 1 (The Gatekeeper): Send the raw listing text and the user profile dealbreakers to Hermes.

Prompt logic: "You are a strict filtering agent. The user is a non-Dutch speaker, has no pets, and is an undergraduate student. Read this listing. Does it explicitly require a Dutch speaker, prohibit students, or demand a Master's/PhD? Answer only YES or NO, followed by a one-sentence reason."

If Hermes returns NO, flag as auto_rejected in the shadow database.

Hermes Pass 2 (The Drafter): If Pass 1 is a YES, Hermes generates the email draft. It reads the room's vibe (formal vs. student house) and tailors the language, picking out landlord names if available.

Phase 4: The "Lazy Review" Discord Loop
The ultimate goal is to apply for housing from your phone between classes without opening a laptop.

The Discord Bot Embed: Upgrade the current webhook to a bot. When Hermes finishes Pass 2, the bot posts an embed to a private channel containing the price, location, a photo thumbnail, and the Hermes draft.

Action Buttons: Add interactive Discord buttons below the embed:

[✅ Send Application]

[🔄 Retry: Too Formal]

[🔄 Retry: Too Casual]

[❌ Reject/Skip]

The Execution: Clicking [✅ Send] pings your local backend. The orchestrator spins up Playwright, navigates to the listing, pastes the approved draft into the contact form, clicks send, and updates the database status to applied.

Phase 5: Next.js Command Center Overhaul
The dashboard transforms from a static list into a functional CRM (Customer Relationship Management) tool.

The Glow-Up: Rip out the basic CSS and drop in Tailwind CSS with shadcn/ui. Use clean, minimalist cards and data tables.

The Kanban Board: Create a drag-and-drop or tabbed view showing listings flowing from Drafted -> Applied -> Rejected.

The Configurator UI: Build a dedicated settings page where users can toggle their platforms (e.g., turning off Kamernet when a subscription expires) and update their dealbreakers (language, commute time, age constraints).

The Shadow Tab: Add a "Filtered" tab where users can occasionally review the auto_rejected listings to make sure Hermes isn't being too aggressive.

Phase 6: Open-Source Packaging
To make this a true self-hosted MVP that other students can easily run:

The Unified Docker Stack: Ensure the docker-compose.yml handles everything seamlessly—it should spin up the Next.js frontend, the single worker loop, and the SQLite volume with one docker-compose up -d command.

Environment Setup: Create a robust .env.example detailing exactly how to get the necessary Discord Bot tokens, Hermes API keys, and platform credentials.

The Branding: Swap out generic icons for the new KamerCatch magpie/key logo. Drop the icon version into the Next.js app/ directory as the favicon.ico, and feature the full logo at the top of the repo's README.md.
