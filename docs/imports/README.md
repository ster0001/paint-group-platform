# Airtable → CRM import

Brief: `docs/briefs/claude-code-brief-airtable-crm-import.md` (rev 3, 16 Sep 2026). Plain-English inventory: `airtable-import-inventory.md`.

The **data pack is not in git**. `docs/imports/airtable-crm-import/` holds real customers (names, emails, phones), so its CSVs, JSON and `booked/` are gitignored and live on Tom's Mac; only `transform.py`, `validate.py`, `build_booked.py` and this README are committed. The e2e suite runs the same loaders against a synthetic pack in `e2e/fixtures/airtable-pack/`.

## What lands where

| Pack file | Table | Notes |
|---|---|---|
| `accounts.csv` | `accounts` | `source = 'airtable'`, `created_at = first_seen_at`, tags as `crm_tags` keys (`airtable_import`, `agency`, `kay_and_burton`, `real_estate`, `commercial`), `company_name` (R1). Lost accounts: `relationship_state = lost`, reason mapped (competitor → went_with_someone_else, other/no_response → something_else, a state note says "No response"), `temperature = cold` (R3). An email that already exists is ATTACHED, never duplicated. |
| `account_contacts.csv` | `account_contacts` | the other names seen under an agency email. |
| `properties.csv` | `properties` | `address_norm` is the PLATFORM's key (`lib/accounts/identity.ts`), so a later wizard save finds the same house; the pack's own key rides in `external_ref`. |
| `estimates.csv` | `estimates` | `source = 'airtable'`, no rate card, no scope (`builder_state = {}`), `valid_until` null so the lapse sweep never touches them. The office view is a read-only card with the PaintScout link. |
| `jobs.csv` | `crm_jobs` | R11: history jobs live in the CRM only — never `work_orders`. Actual hours / materials live here (the cost-capture tables key on work orders). |
| `crm_events.csv` | `crm_events` | direct insert with the pack's dedupe key and `source = 'airtable_import'`; `note` → `note_added` with `author`; `account_created {via: import}`. |
| `follow_up_date` (estimates) | `accounts.followup_due_at` | R9: open follow-ups become the platform's follow-up task, only where none is set. |
| `booked/booked_jobs.json` | `estimates` + `work_orders` | Part B, see below. |

Provenance lives in `external_ref` on accounts, properties and estimates, and in `crm_import_keys` (import name + stable key → row). Facts are rebuilt after every run; nothing is written to `crm_account_facts` by hand.

## Running it

Both loaders refuse to run unless they can name the production project (`PRODUCTION_SUPABASE_REF`, in both env files) and the target is identifiable; production needs `IMPORT_ALLOW_PRODUCTION=1` said out loud. Part A needs a Postgres connection string as well as the API (`IMPORT_DATABASE_URL`, or `C1_DATABASE_URL` for the test project) and both must be the same project.

```bash
# test project
set -a; source .env.test.local; set +a
npx tsx scripts/import/airtable-crm.ts check  docs/imports/airtable-crm-import
npx tsx scripts/import/airtable-crm.ts import docs/imports/airtable-crm-import
npx tsx scripts/import/paintscout-booked.ts check  docs/imports/airtable-crm-import/booked
npx tsx scripts/import/paintscout-booked.ts import docs/imports/airtable-crm-import/booked
```

```bash
# production (Tom): the production URL/key from .env.local, the session-pooler string from Dashboard → Connect
set -a; source .env.local; set +a
export IMPORT_DATABASE_URL='postgresql://…'
IMPORT_ALLOW_PRODUCTION=1 npx tsx scripts/import/airtable-crm.ts import docs/imports/airtable-crm-import
IMPORT_ALLOW_PRODUCTION=1 npx tsx scripts/import/paintscout-booked.ts import docs/imports/airtable-crm-import/booked
```

Order: Part A first (the history creates the accounts), then Part B (the signed jobs find them). Migration `20270152000000_import_provenance.sql` must be live first.

Both are idempotent: a second run reports `inserted 0 updated 0` for every table and `exists` for every signed job. A partial failure leaves whole tables committed and the rest untouched — fix and re-run. `check` validates everything (every value mapped, every key resolved, every signed job priced to the cent by the engine) without writing a row. Part A writes `import-report-<name>-<time>.json` beside the pack with the counts and every note (attached accounts, skipped rows).

`purge --import-name <name>` removes what an import created, by its key map (accounts that already existed are kept). It exists for the test project and the e2e run.

## Re-running from a fresh Airtable export

1. Export the Estimates and Projects tables to CSV.
2. `python3 transform.py --estimates Estimates.csv --projects Projects.csv --out out/` then `python3 validate.py out/` (must report no blocking violations).
3. `npx tsx scripts/import/airtable-crm.ts import out/` — keys are stable across exports, so rows update rather than duplicate.
4. Part B is read from the PaintScout share pages in a browser (`build_booked.py`); after cutover new jobs arrive through the handover door instead.

## Part B — the signed jobs

`lib/import/booked/build.ts` turns each job into the builder's own working scope: one `Area` per work-order area with a `Surface` per line (PaintScout name, quantity, unit, coats, hours; its rate code from `booked_substrate_map.csv`, or the `Custom surface (imported)` row), the area's price split pro rata to hours and rounded to cents (remainder on the last surface, logged), a `LineBlock` for a priced area with no hours (scaffolding, travel…), a hidden $0 line for a bare heading, and one negative line for a discount. Every figure is an override; `sizeUpliftDisabled` and `preparationOverrideCents = 0` keep the engine's own additions off. The build **refuses** unless `priceEstimateTotals` over that state equals the PaintScout subtotal and total to the cent and the hours match.

Three readings of the pack, checked against all 35 jobs: PaintScout's line hours already include preparation (`hours_prep` is a breakdown, so `prepHr` stays 0 and the split is written into the area description); an area with hours but no lines (Interior Preparation, Cleaning) is crew work and becomes an area with one custom surface, so the job sheet and the tray carry the hours; a heading with neither price nor hours is a hidden line so the block count matches the pack.

The write is one RPC, `import_booked_job` — the estimate accepted by hand under the import switch, the office-notified marker and the welcome claim written first so no sweep ever sends a word, the one `estimate_accepted` event with the historical date, and the work order issued at `pre_start` with no contractor and no date (the Unscheduled tray). The Airtable plan ("booked 16–20 Nov 2026 with Jacob — painter accepted. Send the offer.") is a booking note on the tray card, not `access_notes`, because access notes print on the contractor's job sheet. No offers, no invoices, no messages.

## Part C — the handover door

`POST /api/inbound/airtable-jobs` (`Authorization: Bearer AIRTABLE_SYNC_SECRET`) takes the Zap's record plus the PaintScout quote and writes it through the same path. The quote has area prices and the job's total hours but no per-line hours, so the job arrives with `external_ref.hours_pending = true` and an "hours to confirm" item on Today; the office types the per-area hours from the PaintScout work order (Tom's C-1 ruling). A second post for the same record refreshes the tray note only. The Zap setup is in brief §C2.
