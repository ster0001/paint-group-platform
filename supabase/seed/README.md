# Seed data

## `ratecard_v7.sql` — the rate card

Loads Paint Group Rate Card **v7** into the database: settings, modifiers,
colour rules, products, sundries, commercial rates, area names, line-item
templates, and 47 production rate items.

**How to load it:** open the Supabase **SQL Editor**, paste the whole file, Run.
You should see "Success. No rows returned."

**Safe to re-run.** Reference data (settings, products, etc.) is upserted, so
re-running just refreshes it. The rate card itself is *versioned*: the script
creates rate-card version 7 only if it does not already exist, and never edits an
existing version. Every estimate stores the rate-card version it was priced on,
so **loading a new rate card never changes an old quote**.

Money is stored as integer cents throughout (e.g. $85.00 → `8500`).

## `generate-ratecard-seed.mjs` — regenerating for a future version

`ratecard_v7.sql` was generated from the spreadsheet, not written by hand. To
produce the seed for a future rate card (e.g. v8):

```bash
npm install xlsx          # one-off; SheetJS spreadsheet reader
node supabase/seed/generate-ratecard-seed.mjs /path/to/Paint_Group_Rate_Card_v8.xlsx 8 > supabase/seed/ratecard_v8.sql
```

The second argument is the version number, which becomes the new versioned rate
card. Then load the new `.sql` the same way.
