# Portal 3a-7 — the commercial workspace

NO migration. A trade account gets the mockup's commercial persona; a
residential account sees none of it.

- **Granting trade is yours alone (⚑2):** Settings → **Trade accounts** —
  search the customer's email, tap **Grant trade**. (The "unblocked" tick
  there is ⚑1's office unblock: lifts limits without making them trade.)
- **Portfolio Home** — tiles (jobs underway · waiting on you · drafts ·
  invoiced this month inc GST), Start a new estimate, the attention queue
  (variations to approve with price → /v, estimates awaiting acceptance,
  walkthroughs, overdue invoices → pay) and jobs underway with day bars.
- **Properties** — every address with its state, register-on-file and
  warranty note, and **Rebook — same spec**: the wizard opens with the
  prior job's ANSWERS already loaded (validated + stripped of the old
  job's files server-side; ownership proven through the account chain).
  Only asks what's changed.
- **New estimate tab** — repeat a previous job in one tap, start from a
  saved property, drafts. (Named saved-spec templates: deliberate
  follow-up — rebook covers the 2-minute end-of-lease promise.)
- **Money** — "Invoiced this month" consolidated across properties +
  **Monthly statement (PDF)** (print = the white statement). ⚑5 honoured:
  "14-day terms" is display only; no payment behaviour invented.

## Your check (after deploy)

Settings → Trade accounts → search your own email → Grant trade → open
the portal: the portfolio Home appears. Flip back to residential after.

## Proof in CI

- `e2e/portal-commercial.spec.ts` 4/4 live: tiles/queue/underway, the
  rebook link per property, THE REBOOK SEEDING (wizard opens on the
  basics with prior answers + address, no email field), the statement.
- `lib/portal/portfolio.test.ts` (5): aggregation rules — drafts never
  count as invoiced, overdue derives from the shared rule, day bars.
- Regressions: portal-builder/shell + journey interior-loop green.
  Unit 1008.
