# Manual test · CRM v2 Phase 4 — the status model

Branch `feat/crm-v2-p4-status`. Source: `docs/briefs/crm-v2-deep-dive.md` §4.5 (decisions 8.3, 8.4, 8.8, 8.11),
§4.4.5 (saved views), §4.4.7 (thresholds in Settings). Automated: `e2e/crm-p4-status.spec.ts` (5 journeys,
green on C1 7 Sep 2026), `lib/crm/states.test.ts`, `lib/crm/thresholds.test.ts`, stage / work-queue additions.

## Migration to paste (one file, idempotent, read-back at the end)

`20270125000000_crm_status_model.sql` — on `accounts`: `relationship_state` (active · delayed · do_not_contact ·
lost · archived) with `state_until` / `state_note` / `state_reason` / `lost_reason` (the five ruled reasons),
`permit_email` / `permit_sms` / `permit_phone` with `permit_meta` provenance, `tags`; the `crm_tags` list
(8 seeded); the facts row mirrors all of it plus `repaint_due_at`; RPCs `crm_set_state`, `crm_set_permission`,
`crm_set_tags`, `crm_upsert_tag`, `crm_delete_tag`; two rules (either channel declined keeps the guard's
`marketing_unsubscribed_at` set; a NEW estimate re-opens a lost customer); and the `settings.crm` thresholds
row seeded with the defaults.
Expect ONE row: `account_columns` true, `tags_seeded` 8, `email_declined_backfilled` = however many had
unsubscribed, `functions_ok` / `triggers_ok` / `thresholds_seeded` true.

## Walk

1. **The record → Status panel** (under the log panel). Five chips: Active · Delayed · Do not contact ·
   Lost · Archived, each with a one-line explanation of what it does.
   - **Delayed** asks for a date and "what to do when it wakes". The status line reads "Delayed to 12 Mar",
     the card wears the same chip, chase flags go quiet, the customer leaves Today. When the date passes:
     Today → Follow-ups shows "<name> — the delay is up" carrying the note; the record reads "Delay ended".
   - **Lost** asks for one of the five reasons (wording final). Lane = Lost whatever the estimates say.
     Starting a new estimate for them flips them back to Active on its own (and logs it).
   - **Do not contact** silences marketing, sequences and call prompts; invoices and bookings still go.
   - **Archived** (confirm) hides them from every list and count; search still finds them.
2. **May we** — Marketing email / Marketing texts / Phone calls, each Yes / No / Unknown with who-and-when
   underneath. "No" on email or texts shows on the status line ("No texts") and keeps the campaign guard's
   unsubscribe flag set. The unsubscribe link and an SMS STOP now write these too (provenance
   `unsubscribe_link` / `sms_stop`); START writes `sms_start`.
3. **Tags** — the office list (Referral, Repeat customer, Strata, Insurance job, Heritage, VIP, Difficult
   access, Sydney partner) as toggles, plus "New tag…" (Enter) which adds it to the list for everyone. Tags
   show on the status line and as small pills on the Customers list.
4. **Customers → filters row** — Status (incl. "Delay ended"), Tag, Owner (incl. Nobody), Temperature,
   Lifecycle (After-care · Review & referral · Repaint due — from the thresholds). Apply / Clear.
   "Save this view" names the current filter+sort+search for the whole office; view chips appear above the
   list; "Remove view" on the active one. Archived customers never appear unless searched for.
5. **Settings → Communications & automations → CRM** — the thresholds (chase days, going-cold, second
   attempt, past-customer, message and callback overdue hours, after-care, review window, repaint years by
   type) and the tag list. Save → the facts refresh and Today read the new numbers on their next pass.

## Traps found building it

- plpgsql `EXECUTE` never sets `FOUND` — use `GET DIAGNOSTICS … ROW_COUNT` after a dynamic update.
- Next memoises a byte-identical fetch within one request: the record page's re-read after a refresh must
  select a different column list or it gets the stale row back.
- A person's "lost" is a decision, not a deduction: stage.ts returns the Lost lane for `relationship_state =
  'lost'` regardless of the estimates, so the Lost chip and the lane agree.
- Playwright `getByRole("button", { name: "No" })` also matches "U**no**wn" — use `exact: true`.
- The C1 migration runner hit a transient "deadlock detected" twice on this file (Supabase realtime workers
  reacting to the DDL); the file itself is clean — re-run, or apply directly and insert the ledger row.
