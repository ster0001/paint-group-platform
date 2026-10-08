# CRM: "Fix the price without a visit" leaves Today once an estimate is sent; "Not this one" just closes it

Tom, 8 Oct:
1. "Fix price without a visit needs to automatically go out of the CRM once an estimate has been sent."
2. "If I click 'Not this one' on fix price without a visit, it just needs to close."

## What was wrong
- The desk-check card (`desk_check` in `lib/crm/work-queue.ts`) is derived from open `confirmation_requests` rows. Only the Pack's **Fix the price and send** moves that row to `fixed`. The builder's normal **Send** never touches it, so the card stayed on Today after the estimate went out.
- **Not this one** opened the full snooze form for every card: presets, a required "Why?" box, then Dismiss.

## The fix
- **The card works itself out from the sends.** `deskCheckAnswered(row, sends)` drops an ask when a send came after it. It counts the estimate's own `sent` event (so a re-send counts), its `sent_at`, or any estimate for the same customer sent since the ask. `readDeskCheckSends` reads these in two sliced reads, both from the oldest open ask onward: `estimate_events` by `estimate_id`, and `estimates` by `account_id`. Both use existing indexes. Nothing is stored and no dismissal is written. A send before the ask does not count, because the customer asked again. If a read fails, the cards stay up and the failure is listed in `counts.truncated`. Before this change the confirmation_requests read error was also dropped silently; it is now listed there too.
- **One tap on desk-check cards.** On CRM Today, desk-check cards now close with one tap of **Not this one**. It uses the existing `dismissWorkItem` with "for good" and records the reason "Not this one (one tap)". Every other card keeps the presets and reason form.
- `lib/portal/waiting.ts` (the customer side) is unchanged. It passes no sends.

## Migration
None.

## Tests
- Vitest `lib/crm/desk-check-queue.test.ts`: 7 new cases. All 6 that test new behaviour failed on the old code before the fix. `npm test`: 3262 passed.
- e2e `e2e/crm-desk-check-close.spec.ts`, written before the fix, runs as staff (CRM Today has no customer view):
  - sending the estimate removes the card
  - another estimate sent to the same customer removes it
  - **Not this one** closes it with no form, it stays closed after a reload, and a `work_item_dismissals` row exists with `until` null

  It cleans up its own estimates, dismissals, crm_events and accounts (`pg.e2e.deskclose.*@example.com`).
  **Not run locally.** It was refused twice because a CI run held the test project lock (started 11:18Z). The spec runs in CI on this PR.
- `tsc --noEmit` is clean. Lint shows 4 warnings, at the cap, none new.

## Manual test for Tom
1. In the wizard, use a small interior job and choose "fix my price". Or pick an existing *Fix the price without a visit* card on CRM Today → Approvals.
2. Open the estimate and **Send** it from the builder. Go back to CRM Today: the card has gone. It has also gone from Estimates → Waiting on you.
3. On a different *Fix the price without a visit* card, tap **Not this one**. The card disappears straight away with no questions. Reload: it is still gone.
4. On any other card (a follow-up, for example), **Not this one** still asks how long and why.

Help: `docs/help/estimator/staff.md`, `docs/help/crm/staff.md`. Architecture: `docs/ARCHITECTURE.md` (8 Oct paragraph).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
