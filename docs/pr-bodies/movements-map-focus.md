# Movements map: active jobs only, icons only

Branch `feat/movements-map-focus` off `main`. No migration.

Tom's ruling after the first live look (21 Oct 2026): the map showed too much.

- **Only the active jobs.** `onMap(job, today)` in `lib/movements/evaluate.ts` is the one rule: in progress, quality check, completion prep and walk-through always; a closed job (gear still on it) only until **7 days after the job's last payment**; offers and bookings confirmed (`offered`, `pre_start`) never. `Job.paidOn` is new — the latest `payments.paid_on` across the job's invoices, read by the loader in the same round as the jobs (`latestPaidOn`; a failed read is a failure line, never an empty map). `mapPins()` takes `today` and skips what `onMap` refuses, so the bounds now fit the active jobs and Melbourne fills the box.
- **Icons only.** The street, suburb, job ref and need line moved into a popover (`.mpop`) that shows on hover and stays open after a tap (second tap closes). On an amber pin the popover carries **Open …**, which opens the chip the job is waiting on; the icon itself no longer opens it.
- Help: `docs/help/movements/pc.md` Map step 2 rewritten. Ledger + ARCHITECTURE paragraphs.

## Tests
- Unit: `onMap` (every stage, the 7-day edge), `mapPins` filtering with and without `today`, `latestPaidOn`. Movements folder 81/81.
- e2e: `e2e/movements-map.spec.ts` **3/3 on C1 (21 Oct)** — fixture job on site; hover shows the popover; tap → Open → chip sheet → teal; the job set back to `pre_start` leaves the map. (Found on the way: the drag target row has to be clear of the sticky nav bar — the spec centres the order list first.)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
