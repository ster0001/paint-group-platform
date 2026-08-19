# Manual test — A6: window sizes (S / M / L)

What changed: window lines carry a size — small ×0.8, medium ×1.0 (default),
large ×1.2 on the window rate. Multipliers are editable in Settings. The
wizard always writes medium; existing estimates are unchanged.

## Steps (5 minutes)

1. Open any estimate in the **builder**, go to a room with a window line.
   - ✅ The window row has a compact **S · M · L** toggle (right side of the
     row, and in the expanded surface editor next to Count).
2. Note the window line's price. Tap **S** — price ×0.8. Tap **L** — ×1.2.
   Tap **M** — back to the original number exactly.
3. Non-window rows (walls, doors) show no S/M/L control.
4. **Capture**: open a room with windows, go to the review screen.
   - ✅ Window rows carry the same S/M/L chips; the hours placeholder moves
     with the size, and the committed price matches the builder's for the
     same size (parity).
5. **Settings → Pricing & job numbers**: "Window size — small" (0.8) and
   "Window size — large" (1.2) are editable. Change small to 0.7, save,
   reload the builder — an S window reprices ×0.7.
6. If the rate card contains separate small/large window items, the Pricing
   folder shows them flagged as superseded (they still price as before).
7. Golden check: `npm test` (window default = medium = zero price change).
