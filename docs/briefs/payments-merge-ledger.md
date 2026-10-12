# Payments merge — session ledger

Brief: `docs/briefs/claude-code-brief-payments-merge.md`. Branch `feat/payments-merge` (worktree `../paint-group-platform-payments`). One entry per session, newest last.

## Step 0 — kickoff (12 Oct 2026)
- Report: `docs/briefs/payments-merge-step0-kickoff.md`. No app code changed.
- Baseline (§3A.4), production, read 12 Oct 11:37 UTC with `scripts/diag/payments-baseline.mjs --prod`. It matches the brief's figures: 86 invoices, $36,819.33 outstanding on 7, $17,226.71 in 5 contractor invoices to approve. The JSON is kept OUTSIDE the repo (live business totals; the repo is public), in `~/Documents/paint-group-private/payments-merge/`.
- Mockup: the original has real customer names, so it stays outside git (private folder, with the name map). The anonymised copy at `design/reference/payments-merged-v3-mockup.html` is committed (Tom, 13 Oct).

## Tom's rulings (12 Oct 2026), answering the kickoff's open items
1. Urgency: no new `lib/invoicing/attention.ts`. Urgency comes from the one shared overdue rule plus the CRM work queue (CLAUDE.md "one work queue").
2. **Overdue = midday Melbourne on the day after the due date.** Shipped in PR #260 (`ledger.ts` `overdueFrom` / `isOverdue(invoice, now)`). The chase sweep, CRM, portal and reporting all call it.
3. Deposit: **50% standard, adjustable** (Step 3). The old brief's DBCA-cap warning is not built; the legal check stays an open ⚑ for the final PR.
4. Drafts may be **edited or deleted before they are sent**. The leftover drafts (§6.1–6.2) are still hidden by rule until Tom approves deleting a listed set.
5. The mockup lives outside git; the anonymised copy is in the repo (Tom, 13 Oct).
7. **One switch-over at Step 8** (Tom, 13 Oct): no side-by-side preview. Steps 1–7 stay on `feat/payments-merge`; `main` keeps the current Payments page until Step 8 replaces it.
6. Prework fixes merged first (PR #260, `20270255` LIVE on production 12 Oct 11:59 UTC): definer guards, Pause/Resume reminders via an RPC, money deep links, Melbourne dates.

## Step 1 — the job money row and the headline (12 Oct 2026)
- `lib/invoicing/jobMoney.ts` is pure:
  - `jobMoneyRow`: contract, paid, balance, the three slots and their states, the next action, what is collectable now, health, section, and the hidden leftovers.
  - `compareRows`: the one ordering.
  - `jobMoneyPage`: the rows, the four blocks, the seven-lane strip and the headline figures.
  - `headlineSentences`: the sentence.
- Supporting files:
  - Loader: `app/invoicing/jobMoneyData.ts` (paged reads; a failed read returns a failure, never an empty page).
  - Raw JSON for checking: `GET /api/invoicing/job-money` (staff only).
  - Audit: `lib/invoicing/jobMoney.boundary.test.ts`, no cents arithmetic in the page's own files.
- Rules as built:
  - Slot rule: deposit-kind invoices go in the deposit slot, else the first Progress invoice; finals go in the final slot; everything else is progress.
  - Leftover drafts are hidden by rule: $0 drafts, and deposit drafts beside a final.
  - `need` = deposit slot unpaid on Booking confirmed through Walkthrough.
  - `noinv` = booked with no invoice. `uninv` = closed with contract on no invoice.
  - `none` (added) = a slot the job doesn't use.
  - A job with no work order sits in the Offer lane.
  - Draft-only jobs outside Offer and the deposit rule fall under "Other invoices waiting to be paid", rather than being silently dropped as "nothing to collect".
- Gate:
  - 28 golden and audit tests, built from the §6 cases with fictional names. Every slot state is covered, the first-Progress case lands in deposit, and the headline matches exactly.
  - Full unit suite 3,532 passing. Typecheck clean. Lint within the CI ceiling.
- Reconciled on the test project: all 795 jobs' contract, paid and balance equal `public.invoice_ledger` (0 mismatches). The strip sums to the rows, and the Customers block equals the C1 baseline ($66,110.00 on 45 invoices).
- Not run: the JSON route in a browser (the test stack's :3101 was held by another session); it is a thin wrapper over the loader, which the reconciliation exercised.
- No migration. Production figures untouched: Step 1 only reads.

## Step 2 — page shell and the Customers block (13 Oct 2026)
- Page: `/invoicing/payments` (`app/invoicing/payments/`), staff-only behind the invoicing layout. It becomes `/invoicing` at Step 8, the one switch-over.
  - Components: `page.tsx`, `Views.tsx` (To chase · By job stage · All jobs), `JobPieces.tsx` (card, rail, pills, actions, lights), `labels.ts` (words only), `Tools.tsx` (search and Show paid, the only client code).
  - Selection lives in the URL: `tab`, `view`, `stage`, `q`, `paid`, `f`.
  - Actions render but are inert until Step 3 (`data-step` marks the step that wires each one).
- CSS: `payments.css` is the mockup's `<style>`, ported 1:1 by `scripts/design/scope-mockup-css.py` (scoped `.pm`, light theme via the shell's `data-theme`). Regenerate it rather than hand-editing.
  - The old `invoicing.css` used the same short class names (`.r`, `.d`, `.lane`, `.sheet`…), so its page rules are now guarded with `:not(:has(.pm))`. The shell (header, logo, theme button, tokens) is not guarded.
  - The guard adds equal specificity to every old rule, so the current pages render as before.
  - Step 8 deletes the old rules and the guard.
- `lib/invoicing/jobMoney.ts` grew what the page reads:
  - each slot's `lead` (state, days overdue/due, % of contract, views)
  - `next.lead`, `pulse`, `laneTone` / `StageCell.tone`
  - `matchRows`, `tableFilter`, `totalNowCents` / `totalCollectableCents` / `totalOverdueCents`, `headlineParts`

  The loader reads customer view counts (`invoice_events` `viewed`).
- Gate:
  - 34 job-money unit tests and the no-cents-arithmetic audit (now covering the page directory). Full unit suite 3,538 passing.
  - Typecheck clean. Lint within the CI ceiling. Help index current.
  - e2e `e2e/payments-page.spec.ts` 4/4 on C1: anonymous refused (page and JSON); overdue first, the deposit-not-in card orange and pulsing; paid only under Show paid / Paid in full; search, board and table; the stage link; no sideways scroll at 390 px in all three views.
  - Regression: `invoicing`, `contractor-invoicing`, `cost-intake`, `invoicing-read-failure` and `dashboard-invoicing` all pass, 38/38 on the CSS-guarded old page.
- Visual check on C1 at 1440 and 390 px against the mockup: headline, blocks, strip, cards, board and table match.
  - The shell header stays 1080 px wide over the 1280 px page (Step 8 widens it).
  - The Customer chats dock can open over the page, as on every staff page.
- Fixed in passing: `e2e/dashboard-invoicing.spec.ts` built its due dates from the UTC day, so it failed every morning before 10–11am Melbourne (17 days overdue against an expected 16). It now uses `melbourneDatePlus`. The spec is on `main` too, so main's copy stays wrong until this branch merges at Step 8.
- Not done here, by design:
  - Help file: the page is not live until Step 8, which writes the help from the real screens.
  - The headline follows the brief (a zero clause is dropped) rather than the mockup's "Every booked job has its deposit in."
  - Show paid jobs appears on By job stage and All jobs, not on To chase, which never lists paid jobs.
