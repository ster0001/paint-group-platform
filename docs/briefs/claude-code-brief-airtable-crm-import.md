# Claude Code brief — Airtable → CRM import (history, future jobs, handover feed)

**Date:** 16 September 2026
**Repo:** `paint-group-platform`
**Input pack:** `docs/imports/airtable-crm-import/` (CSV per target table + `transform.py` + `validate.py` + `exceptions.csv`; `booked/` for Part B)
**Revision:** 3 — 16 Sep 2026, Tom's eleven rulings applied; Parts B and C added; Part B re-cut to Tom's five Part-B rulings (exact prices, silent acceptance, Unscheduled tray, clean substrates/hours, editable working scope)
**Owner:** Tom

## 1. What we are doing and why

Paint Group's customer history since May 2025 lives in Airtable (Estimates table: 1,444 rows; Projects table: 562 rows). The new CRM (accounts → properties → estimates → crm_events → crm_account_facts) starts empty. This brief loads that history so the Customers list, timelines, stage rules and follow-up rules see every customer we have quoted or painted — not just the ones who arrive through the wizard from now on.

The transform (Airtable → clean CSVs) is already done and re-runnable. Your job is the **loader**: get the CSVs into Postgres safely, with real historical dates on the event log, without tripping the lifecycle triggers, and idempotently.

Headline counts in the pack: 1,048 accounts (42 with an agency `company_name`), 1,306 properties, 1,482 estimates (622 accepted / 210 sent / 375 declined / 44 expired / 231 draft), 549 jobs, 6,016 events. Accepted value $3,907,519 inc GST.

## 2. Reference files — read these first

- `supabase/migrations/20261128000000_customer_accounts.sql` — accounts, properties columns (`address_norm`, `suburb`, `state`, `postcode`), unique index on `lower(email)`.
- `supabase/migrations/20270120000000_crm_identity_contacts.sql` — email-OR-phone reachability constraint, `phone_e164` trigger, `account_contacts`, the merge function.
- `supabase/migrations/20270125000000_crm_status_model.sql` — `relationship_state`, `lost_reason`, `tags`, `permit_*`, `crm_tags`, `temperature`. **Check the allowed values for `lost_reason` and `temperature` and map the CSV values onto them** (the CSV uses `competitor | other | no_response` and `hot | warm | cold`).
- `supabase/migrations/20261205000000_crm_spine.sql` — `crm_events` and `log_event(...)` (signature: p_type, p_account_id, p_payload, p_source, p_occurred_at, p_estimate_id, p_work_order_id, p_invoice_id, p_property_id, p_dedupe_key).
- `supabase/migrations/20270121000000_crm_lifecycle_events.sql` — the AFTER triggers on estimates/work orders/invoices that write events **with `now()`**. The loader must not let these fire for historical rows (see §5).
- `supabase/migrations/20270122000000_crm_account_facts.sql` and `lib/crm/facts.ts` — facts are DERIVED; rebuild after load, never insert.
- `supabase/migrations/20260813000000_initial_schema.sql` — `estimates` (status enum `draft|sent|accepted|declined|expired`, `level_of_finish` required when not draft, `size_band`, integer cents).
- `supabase/migrations/20261213000000_trade_org_layer.sql` and `20270142000000_trade_portal.sql` — how a trade org relates to accounts (needed for R1 — where `company_name` should live).
- `lib/accounts/link.ts` (`ensureAccountAndProperty`) — reuse the address normalisation there if it differs from the pack's `address_norm`; the pack's rule is documented in `transform.py::parse_address`.
- `lib/crm/stage.ts` — stage rules, so you can confirm the imported event kinds drive the expected stages.
- `CLAUDE.md` — one numbered migration per change, integer cents, reference data via seed scripts, update `docs/ARCHITECTURE.md`.
- `docs/briefs/crm-v2-deep-dive.md` — the CRM decisions the schema implements.

## 3. Input pack layout

| File | Rows | Target |
|---|---|---|
| `accounts.csv` | 1,048 | `accounts` (+ `crm_tags` for any new tag keys) |
| `account_contacts.csv` | 56 | `account_contacts` |
| `properties.csv` | 1,306 | `properties` |
| `estimates.csv` | 1,482 | `estimates` |
| `jobs.csv` | 549 | CRM job record on the account (R11) — NOT `work_orders` |
| `crm_events.csv` | 6,016 | `crm_events` via `log_event` |
| `exceptions.csv` | — | not loaded; Tom's review list |
| `summary.json` | — | counts for the acceptance test |
| `transform.py` | — | regenerates all of the above from a fresh Airtable export |

Keys: every row carries a stable `*_key` (`acc_…`, `prop_…`, `est_…`, `job_…`) derived from the Airtable record id or identity. Foreign keys between CSVs use those keys. The loader maps each key to a generated uuid and must persist that map so a re-run updates rather than duplicates.

Column notes:
- `accounts.csv`: `phone_e164` is already normalised (+61…). `company_name` is non-empty only for known agency domains (R1). `tags` is comma-separated (`airtable-import`, `agency`, `kay-and-burton`, `real-estate`, `commercial`). `won_cents`, `estimates_count`, `last_job_completed_*` are for reconciliation only — do not write them, facts are rebuilt.
- `estimates.csv`: `subtotal_cents = round(total_cents / 1.1)` (Airtable amounts are inc GST — verified: Projects.GST = Invoice Amount / 11 on all 556 invoiced rows). `level_of_finish_assumed = yes` where Level 3 was defaulted. `date_confidence = low` where the quote date was missing (74 rows bulk-loaded 30 Apr 2025; others with no Quote Date use the Airtable created time).
- `crm_events.csv`: `payload` is JSON. `event_key` is the dedupe key (`airtable:<recordId>:<kind>[:<n>]`). `source` is `airtable_import`. Event kinds used: `account_created`, `estimate_sent`, `estimate_accepted`, `estimate_declined`, `estimate_lapsed`, `job_started`, `job_completed`, `note`. Notes carry `author` (Tom/Robyn/Debbie when the note was initialled) and `origin`.
- `jobs.csv`: contractor offer, actual hours and materials come from Airtable's cost capture — they are the same facts `claude-code-brief-cost-capture.md` targets, so load them into whichever table that brief made the source of truth.

## 4. Build steps

1. **Migration `supabase/migrations/<next>_import_provenance.sql`.** Add `estimates.source text` (default `'platform'`) and `estimates.external_ref jsonb` (Airtable record id, PaintScout quote/work-order URL, quote number, `date_confidence`, `level_of_finish_assumed`). Same two columns on `accounts` and `properties` (`source`, `external_ref`). Create `crm_import_keys (import text, key text, table_name text, row_id uuid, primary key (import, key))` — the key→uuid map that makes re-runs idempotent. Add `accounts.company_name text` (R1) unless the trade-org layer already has the equivalent. Seed `crm_tags` with `airtable-import`, `agency`, `kay-and-burton`, `real-estate`, `commercial` if not present.
2. **Loader `scripts/import/airtable-crm.ts`** (run with the service role, never from the app). Order: accounts → properties → account_contacts → estimates → jobs → events → facts rebuild. Wrap in one transaction per table so a failure leaves a clean partial you can re-run. Upsert by `crm_import_keys`.
3. **Accounts.** Insert with `account_type`, `email` (null when blank — reachability rule is email OR phone), `phone` (let the trigger derive `phone_e164`; assert it equals the CSV value), `name`, `relationship_state`, `lost_reason` (mapped per §2), `temperature`, `tags`, `source='airtable'`, `created_at = first_seen_at`. If `lower(email)` already exists (a customer who has since used the wizard), **do not create** — attach the history to the existing account and log it.
4. **Properties.** Insert with `account_id`, `address`, `suburb`, `state`, `postcode`, `address_norm`, `created_at` = earliest linked estimate. Reuse the platform's normaliser if it exists; if the pack's `address_norm` collides with an existing property on the same account, reuse that property.
5. **Estimates.** Insert with `status`, `level_of_finish`, `size_band`, `subtotal_cents`, `total_cents`, `sent_at`, `created_at`, `updated_at = coalesce(accepted_at, declined_at, sent_at)`, `account_id`, `property_id`, `source='airtable'`, `external_ref`. No `rate_card_id`, no lines, no areas: these are **history records**, and the portal/estimate views must render them read-only (see acceptance).
6. **Jobs (R11).** Historical jobs live in the CRM only: create a `crm_jobs` table in the provenance migration (account_id, estimate_id, property_id, quote_url, work_order_url, project_name, job_type, status `completed|in_progress|scheduled|accepted_unscheduled|cancelled|on_hold`, start_date, end_date, invoice_total_cents, gst_cents, estimated_hours, actual_hours, estimated_materials_cents, actual_materials_cents, contractor_offer_cents, contractor_invoiced_cents, workers, notes, source, external_ref) and show it on the account timeline/history with the quote link and the start and end dates. Do not create `work_orders` for these. If the cost-capture brief already made a table for actual hours/materials, write those two figures there as well and say which.
7. **Events.** Call `log_event` per row with `p_occurred_at` from the CSV and `p_dedupe_key = event_key`, `p_source='airtable_import'`. `recorded_at` stays `now()`.
8. **Facts.** Run the `lib/crm/facts.ts` rebuild for every imported account.
9. **Docs.** Add `docs/imports/README.md` (how to re-run from a fresh Airtable export: export both tables to CSV → `python3 transform.py --estimates Estimates.csv --projects Projects.csv --out out/` → `pnpm import:airtable out/`) and update `docs/ARCHITECTURE.md` (imported history: what is real, what is assumed, where provenance lives).

## 5. Traps

- **Lifecycle triggers.** Inserting an estimate with `status='accepted'` fires the AFTER trigger from `20270121…` and writes `estimate_accepted` at `now()` — wrong date, duplicate of the CSV event. Either run the load with `session_replication_role = replica` (triggers off) and rely on the CSV events, or have the triggers skip rows where `source = 'airtable'`. Prove which with a test that inserts one accepted estimate and asserts exactly one `estimate_accepted` event with the historical date.
- **Lapse job.** Whatever marks old `sent` estimates as lapsed will sweep the 210 imported `sent` rows on its first run. The pack already moved cold quotes >90 days old to `expired`; check the lapse rule's window and make sure it does not immediately lapse warm/hot quotes that Tom is actively chasing (their `sent_at` is the original quote date).
- **`estimates_finish_required_when_sent`.** Every non-draft row has a `level_of_finish` (1,183 are Level 3, 55 Level 2, 13 Level 4; 231 drafts null). Do not "fix" this by making the constraint weaker.
- **Unique email.** 48 emails carry several names (agencies). The transform already collapsed them to one account each with the other names as `account_contacts`. Do not create a second account for a name.
- **Phones.** 104 numbers were repaired (missing leading 0, 8-digit landlines given 03). 18 were unparseable and dropped — those rows are in `exceptions.csv` under `bad_phone`.
- **`crm_account_facts` is derived.** Never insert into it. Rebuild.
- **Idempotency.** Running the loader twice must change nothing (dedupe keys on events, `crm_import_keys` on rows). The acceptance test runs it twice.
- **Do not touch** `lib/pricing/*`. History rows carry no pricing context and must never be re-priced.

## 6. Acceptance criteria

1. `python3 validate.py out/` in the pack reports no violations before loading (it already does — `validation.json`); then `pnpm import:airtable docs/imports/airtable-crm-import/` completes; row counts in the database match `summary.json` (accounts, properties, estimates by status, events by type) ± the accounts that already existed by email (reported in the loader's log).
2. Running the loader a second time inserts 0 rows and updates 0 rows.
3. For estimate `est_recyOoMntfyrpCH3A` (Justin O'Connor, 56 Main Street Blackburn, $23,542.01): account exists, property exists with `suburb='Blackburn'`, estimate is `accepted`, `total_cents=2354201`, `subtotal_cents=2140183`, and the timeline shows `estimate_sent` (5 Dec 2025), six dated `note` events (9 Dec 2025 → 13 Apr 2026, three attributed to Tom), and `estimate_accepted` on 13 Apr 2026; the job is `scheduled` (Airtable "Job Booked") so there is no `job_started` yet.
4. For `acc_` of `jhine@kayburton.com.au`: one account (R1), `account_type='residential'`, `company_name='Kay & Burton'`, tags include `agency` and `kay-and-burton`, 24 estimates from the Estimates table (38 rows across both Airtable tables), and 5 `account_contacts` for the other names seen under that email (Jennifer Hine, Natalie Hill, Rod Hill, J Rickards, Darren c/o Kay and Burton).
5. Facts rebuild: the Customers list shows imported accounts with the right stage; no account shows `enquiry_unfinished` because of a missing event; `won_cents` per account equals `accounts.csv.won_cents`.
6. Every imported `estimate_accepted`/`job_completed` event has `occurred_at` < `recorded_at` and `source='airtable_import'`; none has today's date unless `payload.date_confidence='low'`.
7. An imported estimate opens in the office estimate view read-only with an "Imported from Airtable" banner and a link to the PaintScout quote URL; it does not open in the wizard and cannot be re-priced.
8. The customer portal, for an account that later verifies its email, lists imported estimates and jobs under history (test: anonymous → magic link → history visible).
9. Failing e2e spec written first per the testing law; unit tests for status/temperature/lost_reason mapping and for the trigger-suppression behaviour.
10. `docs/ARCHITECTURE.md` and `docs/imports/README.md` updated; migration numbered and applied cleanly on a fresh `supabase db reset`.

## 7. Rulings (Tom, 16 Sep 2026) — do not re-open

- **R1 Agencies:** one account per agent email, with a shared `company_name` (e.g. "Kay & Burton") so the company view lists all its accounts. `accounts.company_name` is a new column — add it in the provenance migration (§4.1) if the trade-org layer does not already give a place for it; if it does, map `company_name` onto that instead and say so.
- **R2 Level of finish:** unknowns default to Level 3, `level_of_finish_assumed = yes` in `external_ref`.
- **R3 Lost accounts:** every account whose quotes were all lost or cold is imported `relationship_state = lost` (reason competitor / other / no_response) **and** `temperature = cold`.
- **R4 Cold quotes older than 90 days:** `expired`, with an `estimate_lapsed` event 90 days after the quote.
- **R5 Staff and test rows:** excluded (robyn@paintgroup.com.au, tjhroman@gmail.com, "13 Leamo Crescent Test").
- **R6 Real-estate jobs:** tag `real-estate` on the account; no history goes into trade accounts — every imported account is `residential`.
- **R7 Undated bulk-loaded rows (74):** imported, `date_confidence = low`.
- **R8 Pre-May-2025 customers:** not imported (PaintScout only).
- **R9 Open follow-ups (8):** create follow-up tasks at cutover with the Airtable date.
- **R10 Every job carries its PaintScout quote link** (`jobs.csv.quote_url`) so staff can open the actual job. 23 projects have no link in Airtable — they import with a blank link and are listed in `exceptions.csv` (`job_without_quote_url`); do not invent one.
- **R11 Historical jobs live in the CRM only:** a job record on the account with the quote link, start and end dates, invoice total, contractor offer, estimated vs actual hours, materials and painter count. Do not create `work_orders` rows for completed history — those are for live jobs (Part B).

## 8. Out of scope (Part A)

Importing Airtable timesheets, materials purchases, contractor payments and colour choices (linked tables). Importing PaintScout customers older than Airtable. Re-pricing anything. Marketing permissions (`permit_*` stay `unknown` — nobody in Airtable opted in or out).


---

# Part B — the 35 future jobs: full accepted estimates + work orders, ready to re-schedule

**Input:** `docs/imports/airtable-crm-import/booked/` — `booked_jobs.json` (nested, authoritative), `booked_estimates.csv`, `booked_estimate_areas.csv`, `booked_work_order_lines.csv`, `booked_substrate_map.csv` (line → rate code, side, labels), `substrate_name_map.csv` (distinct PaintScout name → rate code), `booked_schedule.csv` (Airtable dates/painter, for the tray note), `summary.json`.
**Source:** Airtable Projects views *Future Booked Jobs* (21) and *Needs booking* (14), each joined to its PaintScout quote (area prices, subtotal, GST, total, accepted options, discounts) and PaintScout work order (every area, every line with quantity, unit, coats and hours, area L×W×H). Read on 16 Sep 2026.
**Reconciled:** hours match Airtable on 34 of 35 (65 Hotham St is the invoice version, 92 h incl. a 7.5 h variation); totals match on 32 of 35 (three Airtable typos/ex-GST figures — PaintScout used, listed in `summary.json.issues`). Total $341,578.52 inc GST, 2,785.8 hours, $166,698 of contractor offers.

## B0. Tom's rulings for Part B (16 Sep 2026) — these override anything below that reads differently

1. **Price must match the PaintScout quote to the cent** — per area and in total. The engine never prices these; every figure is an override.
2. **These quotes are already signed.** Mark them accepted by hand in the loader. **No customer email or SMS of any kind** — no acceptance confirmation, no welcome, no deposit request, no office "estimate accepted" mail either.
3. **All 35 land in the Unscheduled tray** of the schedule view in the PC dashboard, ready for staff to send out to a painter. Do **not** create booking offers, even where Airtable already names a painter and dates — carry those as a note on the tray card so staff send the right offer.
4. **Hours and substrate names come across cleanly** — every work-order line keeps its PaintScout name, quantity, unit, coats and hours; where the name maps to one of our rate codes it is linked to it, otherwise it is a custom surface with the PaintScout name and never a blank.
5. **The imported scope must be editable in Revision → Working scope**, so a variation can be drafted, signed and invoiced exactly like a native estimate.

## B1. What to build

Per job (`booked_jobs.json` row, with `booked_substrate_map.csv` for the line → rate-code links):

1. **Account + property** — same rules as Part A (`account_key` is the same hash, so the loader finds the account Part A created; create it if the customer only exists here). Property from `address`/`suburb`/`postcode`, falling back to `paintscout_address`.

2. **Estimate row** — `source = 'paintscout'`, `external_ref = {quote_no, quote_url, work_order_url, airtable_id, view, discount_label, options_accepted_ex_gst_cents, airtable_start_date, airtable_end_date, airtable_painter_email, airtable_painter_accepted, airtable_workers}`, `level_of_finish`, `size_band`, `rate_card_id` = the active card (needed so the builder opens; nothing is priced from it), `title` = project name, `created_at`/`sent_at` from `date_accepted_ms`.

3. **Working scope (`builder_state`) — this is what makes the job editable.** Build it in the builder's own shape (`app/quote/QuoteBuilder.tsx` `Block`/`Area`/`Surface`/`LineBlock`, and the `contact`/`jobAddress`/`modSel` keys `lib/estimate/duplicate.test.ts` shows):
   - one `Area` per work-order area that has lines: `name`, `type` Interior/Exterior from `side`, `areaType = "room"`, `L/W/H` from the work order (0 when absent), `description` = the PaintScout area text if you fetch it, otherwise blank;
   - one `Surface` per line: `code` = `rate_code` from the map when set, `internalLabel` = `clientLabel` = the PaintScout item name (never blank), `coats`, `count` for count units, `qtyOverride` = qty for m²/m units, `paintingHrOverride` = the line's hours, `prepHr` = the area's prep hours on the first surface of that area (0 on the rest), `priceOverride` = the area's PaintScout price shared across its surfaces **pro rata to hours, rounded to cents, remainder on the last surface** so the area sums exactly; a line with no rate code is a surface with `code` blank and the same labels — the builder must accept and display it (⚑ if the builder rejects a blank code, add a `custom` rate row "Custom surface (imported)" in the provenance migration and point these at it);
   - one `LineBlock` (`mode = "custom"`, `custom` = price, `woHours` = hours, `crewNote` from the work order) per area with no lines — Preparation, Cleaning, Scaffolding, Scissor Lift, Travel, Accommodation, Parking, Plastering, Carpentry, Rendering, Wallpaper removal, "4 Hallway patches…" and the like; `subcontractorExpense = true` for scaffolding/lift/plaster/carpentry/render (⚑ Tom to confirm costs later);
   - a discount is one `LineBlock` with a negative `custom` labelled with `discount_label`; an accepted option (2826, 2847, 3087) is already inside the area prices — no separate block;
   - `modSel` = `{"Level of Finish": "LOF-<n>"}`, `contact` = customer name/email/phone, `jobAddress` = the property.
   Run the builder's own totals over this state: **subtotal must equal `subtotal_ex_gst_cents − discount`, total must equal `total_inc_gst_cents`** for all 35 (`booked_estimates.csv`). If any override rounding leaves a cent out, put it on the last surface of the last area and log it.

4. **Snapshots** — build `sent_snapshot` (the customer-safe document) and `builder_state.woDoc` with the platform's existing builders from that state, exactly as a native send would, so the estimate page, the work order and the revision diff all read the same scope. `sent_snapshot.totalCents` = `total_inc_gst_cents`; `depositPct` = 50 (Tom's standard; 30-40-30 jobs stay 50 here — ⚑ list any Tom wants changed).

5. **Accepted by hand — silently.** Set `status = accepted`, `accepted_at` = `date_accepted_ms`, `accepted_name` = customer name, `accepted_total_cents` = `total_inc_gst_cents`, `accepted_options = []`. **Do not call `accept_estimate`** (it runs the whole acceptance chain). Before flipping the status: insert `estimate_events` `office_accept_notified`, and claim the reminder rungs for `customer_accepted_welcome` and the deposit request (`lib/automations/reminders.ts::claimRung`) so no later sweep sends them; run the import with the lifecycle triggers off (§5) and write the one `estimate_accepted` event yourself with the historical date, `source = 'airtable_import'`. Test: after the import the messaging outbox has **zero** rows for these 35 accounts, and `notifyOfficeOfAcceptance()` returns `already` for each.

6. **Work order → Unscheduled tray.** `work_orders`: `estimate_id`, `wo_ref = PS-<quote_no>`, `status = issued`, `stage = pre_start`, `issued_at` = acceptance date, `contractor_id = null`, `start_date = null`, `contractor_payment_cents = contractor_offer_cents`, `share_token` fresh, `wo_snapshot` = the v1 document from step 4 (`idealPainters = number_of_workers || null`, so the tray shows the right day count). `access_notes` starts with the Airtable plan so the card tells staff what to send: e.g. "Airtable: booked 16–20 Nov 2026 with Jacob (DJ Decor) — accepted. Send the offer." or "Airtable: needs booking." That is exactly the state `lib/scheduling/board.ts` puts in the tray (issued, pre_start, no contractor, no date, no live offer). **No `booking_offers` rows.**

7. **Revision → Working scope.** Because step 3 filled `builder_state`, the revision builder (`app/quote/QuoteBuilder.tsx` + `RevisionPanel.tsx`, `lib/revision/diff.ts`) diffs edits against the accepted snapshot and drafts variations for signature; invoices then draw on accepted total + signed variations (`revisionActions.ts`). Verify it end to end on one imported job (B3 #6). The imported estimate must **not** open the wizard or re-price on save — overrides stay authoritative until staff clear them deliberately.

8. **Events** — `estimate_accepted` (historical date) only. No `job_started`.

## B2. Traps

- `booking_offers_one_live` is irrelevant here (no offers), but the tray filter is not: a `start_date` or `contractor_id` on the work order takes the job **out** of the tray. Leave both null.
- The lapse sweep for `sent` estimates does not touch `accepted` ones; the "accepted with no booking" CRM card (`registry.ts:488`) will show all 35 — that is correct and wanted.
- Contractor emails in Airtable (`admin@djdecor.com.au`, `isahardani87@gmail.com`, `Younggunpainting@gmail.com`) go into the tray note only; staff pick the painter when they send the offer.
- 65 Hotham Street (3108): use 92 h and $10,087.21 as the pack does (invoice version incl. the kitchen-door variation).
- 12A Cavell Court has two jobs (exterior 3156, interior 3157) at one property — two estimates, one property.
- Substrate map: 737 lines match a rate code exactly, 49 by keyword (check the `keyword` rows once), 41 are custom surfaces (strapping, shingles, picture rails, fretwork, cabinets…) — import with the PaintScout name, never drop them.

## B3. Acceptance criteria

1. 35 estimates, 35 work orders, 342 areas, 827 surfaces/lines. Σ `estimates.total_cents` = 34157852; Σ surface hours = 2785.8; **every estimate's builder total equals its PaintScout total to the cent** (test iterates all 35 against `booked_estimates.csv`).
2. Job 3623 (2 Cootamundra Crescent stage 3): $2,032.80 inc GST; areas Interior Preparation $190 / Kitchen $1,515.50 / Cleaning $142.50; Kitchen surfaces Ceiling 24 m² 3 h, Cornices 20 m 1.5 h, Walls 16 m² 4 h, Skirting Boards 20 m 4.25 h, Window Reveal 1 × 1.25 h, prep 2.5 h; 17.5 h; in the Unscheduled tray with the note "Airtable: booked 29–30 Sep 2026, no painter assigned".
3. Job 3672 (23 Third St): discount block −$233.04 "Custom...", total $16,500.00, 153.85 h, 21 areas, Bedroom 3 present twice (as PaintScout has it).
4. Job 2826 (283 Station Street): tray note "Airtable: booked 16–20 Nov 2026 with Jacob (admin@djdecor.com.au) — painter accepted. Send the offer." and **no** booking_offers row.
5. Zero customer or office messages: `messages`/outbox count for the 35 accounts is 0 after import; `estimate_events` has `office_accept_notified` for each; `notifyOfficeOfAcceptance` returns `already`.
6. Revision round trip on 3623: open Revision → Working scope, add "Hallway walls 20 m² 2 h $250" and save → the diff shows +$275.00 inc GST, a variation drafts for signature, the estimate total is unchanged until signed, and the invoice preview shows accepted $2,032.80 + the signed variation.
7. Schedule board: 35 cards in Unscheduled, none on a lane; dragging 3623 onto a painter creates a normal offer.
8. Re-running the loader changes nothing.
9. Failing e2e spec first (testing law); unit tests for the pro-rata price split (sums to the area price for every area in the pack) and for the substrate map.

# Part C — handover feed: Airtable → new system while both run

**Goal (Tom):** while the handover is on, any project that lands in *Future Booked Jobs* or *Needs booking* is imported automatically, the same way as Part B.

## C1. Design

Follow the existing Airtable transition door: `app/api/inbound/airtable/route.ts` (Zapier webhook action, `Bearer AIRTABLE_SYNC_SECRET`, idempotent per `record_id`). Add a sibling **`app/api/inbound/airtable-jobs/route.ts`**:

- Auth: same Bearer secret. Body: one Airtable Projects record (Zapier-tolerant: numbers as text, dates as text or epoch ms) **plus** the PaintScout quote the Zap fetches in step 2 (`items[]` name/price, `totals` price/hours/afterTax, `contact`, `jobAddress`, `urls`). Zod schema mirrors the materials door.
- Idempotent on `record_id` (and `quote_no`): first call creates account/property/estimate/working scope/work order exactly as Part B (silent acceptance, no messages, straight into the Unscheduled tray with the Airtable plan in the tray note); later calls update the tray note only. Never re-price, never create offers.
- Per-line hours: the PaintScout API gives area prices and the **job total** hours, not per-line hours. The endpoint writes `WOSurface.hours = null` per area and sets `hours_overrides` empty, records `external_ref.hours_pending = true`, and the job appears in the office work queue as "hours to confirm". Then either (a) staff type the per-area hours in the work-order builder (they are on the PaintScout work order page), or (b) run `npx tsx scripts/import-paintscout-workorder.ts <quote_no>` — a small extension of the existing `scripts/scrape-workorders.ts` (Playwright, runs on Tom's Mac, not on Vercel) that reads the share page and fills the surfaces. Build (b) only if Tom wants it (⚑ decision); (a) is enough for a few jobs a week.
- Logs an `intake` row for provenance like the materials door, and a `note` event "Imported from Airtable view <name>" on the account.
- Tests: schema rejects a record without `Quote No`; second POST with the same `record_id` is a no-op; a record whose contractor email is unknown imports without an offer and flags it.

## C2. The Zap (Tom sets this up; Claude Code cannot create Zaps)

Two Zaps, identical except for the view:

1. **Trigger — Airtable: "New Record in View"** · Base *Paint Group* (`appRPGtIU0OITXDwj`) · Table *Projects* (`tbl65JMvlX0Lsn9ng`) · View *Future Booked Jobs* (`viw4lh8bFo5qFLFJY`) — second Zap: *Needs booking* (`viwgLi50etkuXviYP`).
2. **Action — PaintScout: "Find Quote"** · Quote Number = `{Quote No}` from step 1.
3. **Action — Webhooks by Zapier: "POST"** · URL `https://<site>/api/inbound/airtable-jobs` · Payload type JSON · Headers `Authorization: Bearer <AIRTABLE_SYNC_SECRET>` · Data:

```
record_id        {1. ID}
view             future_booked_jobs   (or needs_booking)
quote_no         {1. Quote No}
project_name     {1. Project Name}
status           {1. Status}
first_name       {1. First Name}
last_name        {1. Last Name}
email            {1. Email}
phone            {1. Phone}
address          {1. Address Line 1}
suburb           {1. Suburb}
postcode         {1. Zip / Post Code}
job_type         {1. Job Type}
level_of_finish  {1. Level of Finish}
start_date       {1. Start Date -}
end_date         {1. End Date -}
workers          {1. Number of workers}
painter_email    {1. Worker Assigned Email}
painter_accepted {1. Accept Decline Status Rollup}
offered_amount   {1. Offered Amount}
invoice_amount   {1. Invoice Amount}
estimated_hours  {1. Estimated Hours}
notes            {1. Notes}
quote_url        {1. Quote URL}
work_order_url   {1. Work Order URL}
ps_items         {2. Items}          (name + price per area)
ps_total_hours   {2. Totals Hours}
ps_subtotal      {2. Totals Price}
ps_total_inc     {2. Totals After Tax}
ps_status        {2. Status}
ps_accepted_at   {2. Dates Accepted}
```

Turn the Zaps on the day the endpoint is deployed; turn them off when Airtable is retired. The 35 jobs already in the views are covered by Part B — set the Zap's trigger to "new records only" so they are not sent twice (the endpoint would ignore them anyway by `record_id`).

## C3. Rulings needed from Tom for Part C

- ⚑ C-1: is per-area hours entry by staff acceptable during handover, or build the scrape helper (C1 option b)?
- ⚑ C-2: should a job entering *Needs booking* also create the customer-facing "your job is booked" state, or stay office-only until dates are set? (Recommend office-only.)
