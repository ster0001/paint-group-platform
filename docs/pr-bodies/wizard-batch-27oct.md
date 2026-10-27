# Wizard batch (27 Oct): the Paint Home hand-off has no door into the editor, the walk's size buttons, window size words in the rooms editor, robe walls default No

**Tom, 27 Oct 2026** — four items. No migration.

1. **"When it is out of range, you can still click in to edit details and get into the estimator builder."** The Paint Home over-the-ceiling hand-off ("bigger than we can price from your phone") now offers no way into the editor: the Tighten door added this morning is gone again, the "Change this" links under *What we've assumed* are hidden there, and so is the floating Tighten button. Book a site visit and Send us a message remain; every answer is kept for the visit. (The service-area first screen is unchanged.)
2. **The "Looks right" button on the side's size question** now matches its neighbours: all three chips (Looks right / Adjust it / Not sure) carry a line under them saying what each does, so they sit level.
3. **Window sizing information:** the rooms editor's window box had the S / M / L buttons with no words; the sides editor had "Small is under 50 × 50 cm · Medium 50 cm to 1.5 m · Large over 1.5 m". The rooms box now carries the same line.
4. **Walls inside the walk-in robe** read as No in a bedroom until the customer says otherwise (the question is still there to flip to Yes).

## Proof
- Unit `lib/wizard/cupboard-interiors.test.ts` (bedroom pre-answered No, kitchen still unasked, Yes still wins); full suite green; typecheck clean; lint 0 errors.
- e2e `e2e/marketing/painthome-wizard.spec.ts` test 2 (the forced hand-off) asserts no Tighten door, no Change-this links and no dock button. Items 2–3 are markup only. Local C1 run refused if CI holds the lock; otherwise the PR e2e job.
- Help `docs/help/estimator/customer.md`; `docs/ARCHITECTURE.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
