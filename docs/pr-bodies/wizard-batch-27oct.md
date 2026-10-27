# Wizard batch (27 Oct): out of area stops on screen 1, the walk's size buttons, window size words in the rooms editor, robe walls default No

**Tom, 27 Oct 2026** — four items. No migration.

1. **"When it is out of range, you can still click in to edit details and get into the estimator builder."** Read as the service area: an address that resolves outside the areas we cover used to show "send it anyway" and let the customer walk six screens into the estimator before the gate refused. Now Continue on the first screen goes straight to the outside-area screen (request a call back), the same one the gate would give. The server gate is unchanged. (If "out of range" meant the Paint Home over-the-ceiling hand-off instead, say so — that one keeps Tighten by your earlier request.)
2. **The "Looks right" button on the side's size question** now matches its neighbours: all three chips (Looks right / Adjust it / Not sure) carry a line under them saying what each does, so they sit level.
3. **Window sizing information:** the rooms editor's window box had the S / M / L buttons with no words; the sides editor had "Small is under 50 × 50 cm · Medium 50 cm to 1.5 m · Large over 1.5 m". The rooms box now carries the same line.
4. **Walls inside the walk-in robe** read as No in a bedroom until the customer says otherwise (the question is still there to flip to Yes).

## Proof
- Unit `lib/wizard/cupboard-interiors.test.ts` (bedroom pre-answered No, kitchen still unasked, Yes still wins); full suite green; typecheck clean; lint 0 errors.
- Item 1 cannot be driven on the test stack (no Places key, so an address never resolves out of area there); it is a four-line change beside the gate's own outcome. Items 2–3 are markup only.
- Help `docs/help/estimator/customer.md`; `docs/ARCHITECTURE.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
