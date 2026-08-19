# Manual test — A4: fast removals

What changed: removing a room in the wizard editor is now instant — the card
disappears the moment you tap Remove, and the server's reprice catches up in
the background (~half a second). If a save fails, the room comes back with a
message. The /quote builder was measured and was already fast (its removals
never touch the network).

## The numbers (measured on the dev machine, 11-room estimate)

| Where | Before | After |
|---|---|---|
| /quote surface removal | 32–49 ms, 0 network requests | unchanged |
| Wizard editor remove room (first) | ~820 ms | 33–45 ms |
| Wizard editor remove room (rapid, back-to-back) | 900–1400 ms each | 33–45 ms each |

Measured by `e2e/perf-removals.spec.ts` and `e2e/perf-wizard-editor.spec.ts`
(kept in the repo — re-run them any time with the staff e2e login).

## Steps (5 minutes)

1. Run a no-plan wizard (5+ bedrooms, double storey → 11 rooms).
2. In the editor, open a room card → **Remove**. The card should vanish the
   instant you tap, with the "removed — price updated" toast; the price
   updates a moment later.
3. Rapid-fire: remove three rooms as fast as you can tap. Each card should
   vanish instantly — no waiting between taps.
4. Flight mode on, remove a room: the card should COME BACK with "That
   didn't save — check the connection and try again."
5. /quote on a big estimate: open a room, remove surfaces — still instant,
   and the network tab shows no requests per removal.
