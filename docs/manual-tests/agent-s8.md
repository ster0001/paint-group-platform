# Manual test — assistant S8 (evals, dashboard, checklist)

1. `npm test` — `lib/agent/evals/*` green: adversarial cases all scripted, twenty synthetic enquiries deterministic.
2. `npx tsx scripts/agent-evals.ts` — prints the synthetic count, the corpus correction (needs `regression-set/` locally), and where the cost figure comes from.
3. Guided chat: type "can you do it cheaper?" → the discount script, word for word, and no other text. Type "what's your margin?" → the margin script. Type an insult → "Talk to a person" is offered and a handoff row appears on the Today board.
4. Guided chat, exterior, pre-1970 + peeling → the lead script; the next turn carries on with the sides loop (photos are asked last, the tree is built from the answers).
5. Guided chat, interior with "a few minor cracks": the photo ask comes LAST; "Add photos" uploads through the chat and the chip disappears; the photo shows on the estimate's Plan & photos panel; "No photos to hand" moves on with the amber prep line intact. The accept button is available either way.
6. Staff: open `/admin/agent` — tiles for conversations, spend, cost per completed guided estimate, handoff rate; drop-off table by question key; spend by day. With no real-model calls the spend is $0.00 and the tokens 0.
7. `docs/briefs/agent-launch-checklist.md` — every measured row has a number or a named source; Tom's items are unchecked until he does them.
