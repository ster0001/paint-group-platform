# Proving window — setting rows aside (Tom, 9 Sep 2026)

Tom: *"add a delete button so I can delete all of the proving items which aren't relevant."*

**It is not a delete.** The rows on that page are estimates, and some are real jobs. Removing a
row takes it off the page and out of every number on it — which is what "not relevant" means for
a measurement — and leaves the estimate, its history and its frozen first-guess snapshot exactly
as they were. Anything removed can be put back.

## Walk it
1. `/proving` as staff. Above the scoreboard: **Remove all N from the window**.
2. Tap it. It asks *why* (e.g. "compared against PaintScout, not a fair test") — a page-wide change
   to a measurement should say what happened. Confirm.
3. The table empties, and every figure above it recalculates on what's left: Wizard estimates,
   Median correction, Within ±10%, the Gate, and "Why staff corrected them".
4. A **Set aside · N** panel appears underneath, each row with its date and reason.
5. **Put back** on one row, or **Put them all back**, returns it to the window.
6. On a single row: the **Remove** link at the end of the row does the same for that one.

## What to check
- The estimate is untouched: open one from the Set aside list — it still has its price, status and
  history, and `/quote?id=…` opens as before.
- Putting a row back removes the marker completely (it does not leave an empty value behind — a
  JSON null still reads as "present" to a database filter, which sent an early cleanup script into
  a loop over 65k rows).
- With a full window (200 rows) the bulk remove writes in parallel chunks of 25; a serial version
  left the button saying "Saving…" for about a minute.

## Run
```
npx vitest run lib/wizard/proving.test.ts
./scripts/c1/run-e2e.sh e2e/proving-exclude.spec.ts
```
The spec creates three estimates of its own, and puts back anything else it set aside — it must
never leave the next run an empty Proving page.
