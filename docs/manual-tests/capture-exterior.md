# Manual test — capture: exterior estimates

First: re-run the seed once to load the four new prep add-on rates:

```bash
cd ~/Documents/paint-group-platform && export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && SEED_STAFF_EMAIL="pg.sam.staff@gmail.com" SEED_STAFF_PASSWORD="painttest123" npx tsx scripts/seed-extraction-settings.ts
```

## Steps

1. Open any estimate → Capture detail → switch the vocab to **Exterior** and
   add "Front" (or open a wizard exterior elevation card).
2. ✅ The substrate tiles are all there now: Weatherboards / Render / Stucco /
   Brick, Fascias / Gutters / Eaves / Downpipes, Windows + door tiles, and
   the extras (deck, fence, pergola…).
3. ✅ The header says "elevation · one plane, width × height" and asks for
   **Width** and **H** only — no room L×W.
4. Tap **Weatherboards** once → 100 %. Tap again → 75 %, again → 50 %,
   again → 25 %, once more → off. The m² shown scales with the %.
5. Tap **Windows** repeatedly → × 1, × 2, × 3 … (long-press/− to reduce),
   same for the door and garage tiles.
6. Enter Width 12, H 2.6 → weatherboards at 75 % shows ≈ 23.4 m²; commit the
   elevation and check the builder: the area arrives as a SURFACE plane and
   the priced qty matches.
7. In **Review**, every substrate row now has the add-on chips:
   **Needs bogging · Needs stripping · Scraping & filling · Caulking** —
   tap to add (tap again for severity 2/3, again to clear), set the affected
   m²/lin m, and the prep hours and price move. They ride to the work order
   as crew notes with hours.
