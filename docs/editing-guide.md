# Editing guide

This guide explains the common changes you may want to make and exactly where
to make them. It assumes you can read a little TypeScript, but you do not need
to be an expert.

## Change filters and messages (no code)

Most changes do not require touching code. Open the dashboard and go to
**⚙️ Settings**.

| You want to…               | Where                                          |
| -------------------------- | ---------------------------------------------- |
| Change max rent            | Settings → Filters → Max rent                  |
| Change rent flexibility    | Settings → Filters → Rent flexibility          |
| Change distance limits     | Settings → Filters → Max cycling / Max walking |
| Ignore Dutch-only listings | Settings → Filters → Skip Dutch-only listings  |
| Change your name or email  | Settings → Your profile                        |
| Change apply behavior      | Settings → Applying                            |
| Change the message text    | Settings → Message templates                   |

The message templates use placeholders that KamerCatch replaces automatically:

- `{{name}}` — your first name
- `{{email}}` — your email
- `{{title}}` — the listing title
- `{{address}}` — the listing address
- `{{rent}}` — the monthly rent
- `{{type}}` — room, studio, apartment, etc.

The **landlord** template is used for studios, apartments, and houses. The
**co-optation** template is used for rooms and student houses.

## Add or remove a website (scraper)

Scrapers live in `worker/`, one file per website.

1. Create a new file, for example `worker/scraper-mysite.ts`. Copy the shape of
   an existing scraper such as
   [`worker/scraper-pararius.ts`](../worker/scraper-pararius.ts).
2. Export a function that returns the number of new listings inserted.
3. Call `insertListing` for each listing you find. The ID must be stable; use
   `hashUrl(listing.url)` from
   [`worker/shared/hash.ts`](../worker/shared/hash.ts).
4. Register the scraper in
   [`worker/orchestrator.ts`](../worker/orchestrator.ts) by importing it and
   calling `runIfEnabled`.
5. Add a default setting key `scraper_mysite` in
   [`worker/shared/db.ts`](../worker/shared/db.ts) and in
   [`dashboard/app/api/settings/route.ts`](../dashboard/app/api/settings/route.ts).
6. Add the platform toggle in
   [`dashboard/app/settings/page.tsx`](../dashboard/app/settings/page.tsx).

To disable a website without deleting code, turn it off in the dashboard
Settings.

## Fix a scraper that stopped working

Websites change their layout often. The usual fix is to update the selectors.

1. Open the scraper file for that website.
2. Look for the `$$eval` or `locator` calls that read the page.
3. Update the CSS selectors to match the new page layout.
4. Rebuild and watch the logs:

   ```bash
   docker compose up --build
   docker compose logs -f scraper-orchestrator
   ```

Each scraper saves a screenshot to `/app/data/` when it finds no listings, which
is visible in the local `data/` folder on your machine.

## Change the filtering logic

The filtering order and rules are in
[`worker/shared/triage.ts`](../worker/shared/triage.ts). The function
`triageListing` is the single place where a listing is accepted or rejected.

- Rent, Dutch-only, and distance rules are at the top of `triageListing`.
- The message draft is generated at the bottom.

Distance patterns are in
[`worker/shared/distance.ts`](../worker/shared/distance.ts). Add a new regular
expression there if you want to recognize a new way landlords describe distance.

Dutch-only patterns are in
[`worker/shared/dutch.ts`](../worker/shared/dutch.ts).

## Change the message generation

The templates themselves are edited in the dashboard. The code that fills them
is in [`worker/shared/templates.ts`](../worker/shared/templates.ts).

- `chooseTemplate` decides which template a listing uses.
- `renderTemplate` replaces the `{{placeholders}}`.

## Change the dashboard UI

The dashboard is a Next.js app in `dashboard/`.

| File                                                                                      | What it contains                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------- |
| [`dashboard/app/page.tsx`](../dashboard/app/page.tsx)                                     | The board, filters, and listing cards |
| [`dashboard/app/settings/page.tsx`](../dashboard/app/settings/page.tsx)                   | The settings page                     |
| [`dashboard/app/api/settings/route.ts`](../dashboard/app/api/settings/route.ts)           | Settings read/write endpoint          |
| [`dashboard/app/api/listings/[id]/route.ts`](../dashboard/app/api/listings/[id]/route.ts) | Listing status updates                |
| [`dashboard/components/ListingActions.tsx`](../dashboard/components/ListingActions.tsx)   | The move/reject buttons on each card  |

The brand images live in `dashboard/public/branding/`.

## Rebuild after changes

```bash
docker compose up --build -d
docker compose logs -f scraper-orchestrator
```

The worker logs show which sources ran, how many listings were found, and the
triage result for each cycle.
