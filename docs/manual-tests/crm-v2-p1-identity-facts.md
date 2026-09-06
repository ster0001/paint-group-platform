# Manual test · CRM v2 Phase 1 — identity, self-feeding event log, facts layer, lapsing

Branch `feat/crm-v2-p1-identity`. Source: `docs/briefs/crm-v2-deep-dive.md` §3 (faults F1, F2, F4)
and §7 (phase P1). Automated: `e2e/crm-p1-facts.spec.ts` (4 journeys, green on C1 7 Sep 2026),
`lib/crm/facts.test.ts`, `lib/crm/stage.test.ts` (lapsed/lost), `lib/crm/work-queue.test.ts`
(estimate_lapsed).

## Migrations to paste, in order (all idempotent, each ends with a read-back)

| File | What it does | Read-back to expect |
|---|---|---|
| `20270120000000_crm_identity_contacts.sql` | email optional, `phone_e164` + trigger, `owner_id`, `account_contacts` (+ backfill, one primary per account), `crm_find_account`, `crm_merge_accounts`, `crm_duplicate_candidates` | ONE row: `email_optional` true, `primary_contacts` = `accounts`, `normaliser_ok` true, `functions_ok` true, `contact_policies` 1 |
| `20270121000000_crm_lifecycle_events.sql` | triggers on estimates / estimate_views / work_orders / invoices writing `estimate_sent · viewed · accepted · declined · lapsed`, `job_started · completed`, `invoice_sent · paid` into `crm_events`; backfill of history; `crm_lapse_estimates()` | a per-kind count table (non-zero for sent/accepted at least), then ONE row: `triggers_ok` true, `emitter_secdef` true, `lapse_fn_ok` true, `would_lapse_on_first_sweep` = how many sent quotes are past their valid_until TODAY (read this number — the first sweep will expire them) |
| `20270122000000_crm_account_facts.sql` | `crm_account_facts` (cached card per account), staleness triggers, `crm_board_counts()`, `crm_board_tiles()` | ONE row: `facts_rows` = `accounts`, `stale_rows` = `accounts` (the sweep fills them), `touch_triggers` 6, `policies` 1, `trgm_index` true |

Then either wait for the daily cron (`/api/cron/crm-sweep`, 20:15 UTC = 06:15 Melbourne) or fill the cache
at once: `curl -H "Authorization: Bearer $CRON_SECRET" "https://<site>/api/cron/crm-sweep?rebuild=1"`
(27,567 accounts took 3.6 minutes on C1; production's few hundred takes seconds). Until a row is refreshed
the list shows it with a blank card line — never an error — and any page that shows a stale row refreshes it.

## Walk

1. **Customers tab** — heading is a real count. Type part of a name, a phone (with or without spaces), an
   email or a street into the search box → the list narrows; the `×` clears it. Chips: All / Leads /
   Quote sent / **Lapsed** / Live work / Past customers / **Lost** / Trade & B2B, each with a count. Page
   through with Back / Next; the footer reads "1–50 of N".
2. **Board** — every lane shows its true count and the top 25 cards; "N more in the list →" jumps to the list
   filtered to that group. Two new lanes: **Quote lapsed** and **Lost**.
3. **A record** — the timeline now carries "Estimate sent", "Estimate opened" (once per viewing session,
   with "Second time." etc.), "Estimate accepted / declined / lapsed", "Job started / completed",
   "Invoice sent / paid". Nothing in the app wrote these; the database did.
4. **Log a call** on a record → back on the list that customer reads "today", not "Nd quiet" (calls count as
   activity now).
5. **Lapsing** — a sent estimate past its valid_until becomes `expired` on the next sweep; the customer moves
   to the Lapsed chip / "Quote lapsed" lane; Today gets "<name>'s quote lapsed · $X · sent Nd ago · never
   opened · chase, re-send, or mark lost" (Follow-ups, "waiting on them" for two days). Logging any call on
   the record retires it. Re-sending the estimate moves them straight back to Estimate sent.
6. **Phone-only customer** — an account with a phone and no email now saves (the wizard/estimate save path
   accepts it; the record shows "Unnamed"/phone until named). Search by digits finds it.
7. **Duplicates** — `select * from crm_duplicate_candidates(50)` lists pairs by phone / email / address;
   `select crm_merge_accounts('<keep>', '<drop>')` moves everything (estimates, invoices, properties, events,
   contacts, enrolments, dismissals) to the kept record, fills its blanks, logs "Merged a duplicate record"
   on its timeline and deletes the other. (The record-page UI for this is P2.)

## Traps found building it

- `on conflict (account_id) where is_primary` — a partial unique index needs its predicate in the conflict
  target or Postgres cannot infer it.
- `crm_events` is append-only by trigger; a merge must re-point `account_id`, so the guard makes ONE
  exception, only when the transaction-local setting `crm.merge = on` (set inside `crm_merge_accounts`).
- The generic "move every FK" loop in the merge must skip `crm_account_facts` (the kept account already has
  a row — PK violation) and the function must not name that table directly (it is created two migrations
  later; `to_regclass` + `execute`).
- `create table if not exists` does not add a column on re-apply; `meta` needed an explicit
  `add column if not exists` for the test stack.
- Playwright runs the spec's tests in file order only with `test.describe.configure({ mode: "serial" })`;
  the lapse happens in test 1 and everything after reads it.
- The volume seed's estimates carry `status = 'sent'` with no `sent_at`; "sent" means a stamp OR a status
  past draft, or the backfill writes 16 events instead of 45,000.
