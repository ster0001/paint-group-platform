# Manual test · fill a handover job's hours from the PaintScout work order (22 Sep 2026)

Branch `feat/import-fill-work-order` · migration `20270187000000_import_booked_job_set_scope.sql` (paste, read the read-back row against its `_expect_`, confirm the `_prod_migrations` row).

## The three jobs Tom asked for
Quotes 3613 (Kerferd St, exterior, 84 h), 3639 (Williamstown Rd, exterior, 140.15 h) and 3688 (Collins St, interior, 29.75 h). Each should be on production as a handover job with **Hours to confirm** on its strip.

1. What the pages say, no database:
   ```bash
   npx tsx scripts/import/fill-work-order.ts parse 'https://app.paintscout.com/view/?view=work-order&u=txjjnyjs5mwgxdtgqsw' 'https://app.paintscout.com/view/?view=work-order&u=up28oyrjnwxqiaebgku' 'https://app.paintscout.com/view/?view=work-order&u=cosg2cvpcohmox79px'
   ```
   Expect: 84 h / 140.15 h / 29.75 h, each "lines add to" the same figure.
2. The join and the proof against production, nothing written:
   ```bash
   set -a; source .env.local; set +a
   IMPORT_ALLOW_PRODUCTION=1 npx tsx scripts/import/fill-work-order.ts check '<url 1>' '<url 2>' '<url 3>' --save-dir /tmp/wo
   ```
   Read the mapping lines: every work-order area names the quote price it took. A ⚠ line means an area with no twin — read it before step 3. "proves: $… inc GST" must be the signed total.
3. Write, from the saved text (no second page load):
   ```bash
   IMPORT_ALLOW_PRODUCTION=1 npx tsx scripts/import/fill-work-order.ts run /tmp/wo/3613.txt /tmp/wo/3639.txt /tmp/wo/3688.txt
   ```
   Expect one `ok` line per quote with its hours and tick-list rows. Run it again: `skip:filled` ×3.
4. On the app: **Today** no longer shows the three "hours to confirm" cards. Open each estimate: the amber strip has no **Hours to confirm**; **Work order** tab lists every area with its lines, hours and products; the materials block shows PaintScout's litres with colours TBC. **PC → Schedule**: the three cards still sit in the Unscheduled tray at Offer — send the offers.
5. Open `/w/<token>` from the work order tab as a painter (private window): the lines and hours are there; no price, no surname, no email.

## Refusals to expect
- A job whose Total Hours banner disagrees with its lines: `REFUSED … disagree` — nothing written for any job in that run.
- A job already booked past pre_start, or with a surface ticked: `skip:<stage>` / `skip:worked` from the function.
- A quote number with no imported estimate: `REFUSED … no imported estimate on this project`.
