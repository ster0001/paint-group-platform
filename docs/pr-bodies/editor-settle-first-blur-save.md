# Tighten editor: "A few details to settle" stands out and comes first; measurements save when you click out

**Tom, 28 Oct 2026:** "make this stand out more — the customer needs to answer these questions first, before anything else" and "instead of a Save button, as soon as you have edited the measurements box and click out, auto save". No migration.

## What changed
- **Details first.** The card wears a *Start here* kicker, a cyan frame and a lead line ("Answer these first — the rooms and everything below follow from them"); while any detail is open, everything below it is dimmed. It comes back to full strength the moment the last detail is answered. The rooms stay tappable underneath — a steer, not a lock — because the customer-journey suite (and an impatient customer) taps rooms first; say the word if you want it locked hard and I will update those specs with it.
- **Measurements save on click-out.** Room length × width (and the optional ceiling height): the boxes save when you leave them, with a "saves when you click out" line while you are typing; the *Update size* button is gone. Outside sides' length × height do the same (Enter works too); a side pre-filled from the opposite side keeps a one-tap **Keep these**.

## Proof
- Checked in the browser on the test stack: the framed card at the top of the editor with the dimmed rooms below; typing a width and clicking the card heading saved it ("Bed 1 updated … repriced") with no button.
- Five specs updated to blur instead of pressing Update / Update size (`tom-batch-25oct`, `tom-batch-7oct`, `exterior-v2-tighten`, `sides-editor`, `pr-screenshots`). Typecheck clean; lint 0 errors; unit suite green. Local C1 result in the PR conversation if the lock was free; otherwise the PR e2e job.
- Help `docs/help/estimator/customer.md`; `docs/ARCHITECTURE.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
