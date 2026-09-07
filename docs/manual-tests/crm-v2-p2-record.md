# Manual test · CRM v2 Phase 2 — the customer record

Branch `feat/crm-v2-p2-record`. Source: `docs/briefs/crm-v2-deep-dive.md` §4.1 (phase P2).
Automated: `e2e/crm-p2-record.spec.ts` (4 journeys, green on C1 7 Sep 2026).

## Migration to paste (one file, idempotent, read-back at the end)

`20270123000000_crm_record_writes.sql` — the record's write RPCs (`crm_update_account`, `crm_set_owner`,
`crm_upsert_contact`, `crm_delete_contact`, `crm_create_account`), the facts trigger learning the two
manual contact kinds, and — important — the row-level policies on `crm_account_facts` and
`account_contacts` rewritten so the tenant check runs once per statement, not once per row (on the
27,000-account test stack the Customers list hit the 8 s statement timeout without this).
Expect ONE row: `functions_ok` true, `create_secdef` true, `facts_trigger_ok` true, `tenant_fn_stable`
true, `policies_initplan` 2.

## Walk

1. **Customers → "+ New customer"** — name and phone only. Lands on the new record with "New customer
   added". Do it again with the same mobile (spaces or not) → "Already a customer — this is their record".
2. **The head** — the phone is a tap-to-call link, the email a mailto. "Edit details" edits name / phone /
   email in place; a taken email says so and links the other record; the timeline gets "Details updated".
3. **Owner** — the dropdown lists staff; choosing one writes "Owner set" and the status line shows
   "Owner: …". New records are owned by whoever created them.
4. **Status line** — lane, the card's line, "opened N×", temperature, snooze, follow-up date, owner. Tiles:
   Latest estimate, Since it was SENT (from `sent_at` now, not created), Won so far, Last contact (by …).
5. **Log something** — six outcomes (called no answer / voicemail / spoke / emailed / texted / note), a
   line, and "Come back to this": no reminder / tomorrow / 3 days / next week / a date. Save → timeline
   row, Last contact tile reads "0d ago", status line shows the follow-up. ⌘/Ctrl+Enter saves.
6. **Follow up on / Snooze until** — presets plus a date picker plus "Set date"; a live one shows a
   "Clear (…)" chip. The "why" box rides along as the note or reason.
7. **Estimates / Jobs / Invoices / Properties** — every one listed with a status pill and an "Open →"
   into the builder, the job page, the invoice; properties have a Map link.
8. **People on this account** — the primary row is the account; "+ Another person" adds a partner / agent /
   tenant / site contact with phone, email, preferred channel and a note. Matched by inbound replies from
   P3 on.
9. **Duplicate banner** — a second record with the same mobile/email/address shows "Possibly the same
   person" with "Merge into this record"; the merge moves everything, logs itself, deletes the other.
10. **Today** — every item with a customer has a "Log" button that opens the same sheet in place.
11. **Global search** — the box in the top bar (⌘K / Ctrl+K): name, phone digits, email, address or an
    estimate title; arrow keys + Enter; opens the record or the estimate.

## Traps found building it

- A `"use server"` module may export only async functions — shared constants live in `recordTypes.ts`.
- `text[] || 'literal'` in plpgsql parses the literal as an array ("malformed array literal") — use
  `array_append`.
- Row-level policies must write `tenant_id = (select public.current_tenant())`, never the bare call: the
  bare call runs per row and the list timed out at 27k rows.
- Playwright: two "Save" buttons on the record (details, log sheet) — scope by test id.
