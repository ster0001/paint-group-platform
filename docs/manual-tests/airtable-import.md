# Manual test — Airtable → CRM import (16 Sep 2026)

Run on the TEST project first (`set -a; source .env.test.local; set +a`), then on production the day of cutover.

## 0. The migration
Paste `supabase/migrations/20270152000000_import_provenance.sql` in the SQL editor. The last SELECT must show every column `true`, `import_policies = 2`, `custom_rate_rows = 2`, `tags_seeded = true`.

## 1. Part A — history
```bash
npx tsx scripts/import/airtable-crm.ts check  docs/imports/airtable-crm-import     # "pack ok: 1048 accounts …"
npx tsx scripts/import/airtable-crm.ts import docs/imports/airtable-crm-import     # accounts inserted 1047 … facts rebuilt
npx tsx scripts/import/airtable-crm.ts import docs/imports/airtable-crm-import     # second run: inserted 0 / updated 0 everywhere
```
Expected on the second run: `accounts unchanged 1047`, `estimates unchanged 1481`, `events unchanged 6003`. One account (Chelsi Ross) is skipped — no email, no phone.

Then in the app:
- **CRM → Customers**, search "Kay & Burton": ~30 agent records; open Jen Hine — company beside the name, tags Agency · Kay & Burton · Real estate, 24 estimates, 5 people on the account.
- Open Justin O'Connor: an accepted estimate of $23,542.01 (opens as an amber "Imported from Airtable" card with the PaintScout link), "Jobs before the platform" shows 56 Main Street · Booked, the timeline shows the six notes with their 2025–26 dates and three "— Tom".
- **Estimates**: the "Imported history" chip lists them; "All" does not.
- **Today**: imported open quotes appear as follow-ups for hot and warm customers only.

## 2. Part B — the 35 signed jobs
```bash
npx tsx scripts/import/paintscout-booked.ts check  docs/imports/airtable-crm-import/booked   # $341578.52 · 2785.8 h · 342 areas · 827 lines
npx tsx scripts/import/paintscout-booked.ts import docs/imports/airtable-crm-import/booked   # created ×35
npx tsx scripts/import/paintscout-booked.ts import docs/imports/airtable-crm-import/booked   # exists ×35
```
- **PC → Schedule**: 35 cards in Unscheduled, each with an "Airtable: …" note; 283 Station Street says "booked 16–20 Nov 2026 with Jacob (admin@djdecor.com.au) — painter accepted. Send the offer." Nothing on a painter's lane.
- Open 2 Cootamundra Crescent stage 3 from the tray: amber "Imported from PaintScout" strip, total $2,032.80, Kitchen with Ceiling 24 m² 3 h … Window Reveal 1 × 1.25 h; the job sheet totals 17.5 h.
- **Revision → Working scope** on it: add a surface, save, the diff prices it and drafts a variation; the accepted total does not move.
- Nobody received an email or text: Settings → Messaging → outbox has nothing for these customers; no deposit invoices exist.
- Drag 3623 onto a painter — a normal offer goes out.

## 3. Part C — the handover door
Set up the two Zaps in brief §C2. Post one record; the job appears in the tray with "Hours to confirm" on its strip and on Today; type the area hours from the PaintScout work order.

## Draft deposits (17 Sep)

1. Invoicing → open one of the 35 imported jobs (PS-xxxx). Expect one **draft** deposit for 50% of the accepted total, unnumbered, no due date, with the line "Deposit — 50% of the contract price, payable on acceptance".
2. The job's money strip still shows nothing invoiced (a draft does not count).
3. Issue it and record the PaintScout payment on a job you know was paid; void it on a job with no deposit. The final at sign-off then bills the balance.

