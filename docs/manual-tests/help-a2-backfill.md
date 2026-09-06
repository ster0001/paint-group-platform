# Help content — session A2 (scheduling + self-invoicing backfill) — Tom's review

No migration. This is a READING test, not a clicking one: the brief's acceptance is that a contractor who has
never used the platform gets from "I received an offer" to "I've sent my invoice" from the files alone.

## 1. Read the contractor scheduling file cold (10 min)
Open `docs/help/scheduling/contractor.md` (GitHub renders the screenshots). Read it as a painter who has just
been invited. Note anywhere you would have to ask someone. That list is the review.

## 2. Read the contractor invoicing file the same way (5 min)
`docs/help/self-invoicing/contractor.md`. Same test.

## 3. Skim the two staff files (5 min)
`docs/help/scheduling/staff.md` and `docs/help/self-invoicing/staff.md`. Check the wording matches how you
would explain it to a new office hire, and that nothing promises a timing or policy you have not set.

## 4. Spot-check three screenshots against production (3 min)
Open the scheduling board, a contractor offer card (on a test login) and Payables. Confirm the labels in the
pictures are the labels on screen. Any difference = the screen changed after 6 Sep; re-run the capture spec.

## 5. The index (30 s)
```bash
cd ~/Documents/paint-group-platform && export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && npm run help:index -- --check
```
Expect `help:index — 4 help files indexed, _index.json is current.`
