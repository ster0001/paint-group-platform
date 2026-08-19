# Manual test — A2: exterior substrates on wizard page 2

What changed: the surfaces page is now driven by the rate card. Exterior jobs
show exterior substrates (weatherboards, gutters, deck…), interior jobs show
the interior list, and "Both" shows the two as grouped sections.

## Steps (5 minutes, on localhost or the live site)

1. Log in as staff and open **/wizard**.
2. On page 1, pick **Exterior**. Go to page 2.
   - ✅ You should see ONLY exterior items: Weatherboards, Render, Eaves,
     Fascias, Gutters, Downpipes, Windows, Doors, Garage doors, Deck, Fence,
     Pergola, Balustrade & hand rails.
   - ✅ Pre-ticked: the body + trims + windows/doors. NOT ticked: garage
     doors, deck, fence, pergola, balustrade.
   - ❌ You should NOT see Walls, Ceilings, Cornices, Skirting boards.
   - Note: **Brick (painted)** only appears after you run the 20260919
     migration that adds its rate — that's deliberate.
3. Go back to page 1, pick **Both**. Page 2 should show two sections:
   **Inside** (the old list) and **Outside** (the exterior list).
4. Pick **Interior** again — page 2 back to the usual interior list, with the
   usual six pre-ticked.
5. Finish an **Exterior** wizard run (add 2 facade photos or a listing link,
   tick Deck as well). After submit, open the estimate in the builder:
   - ✅ Exterior elevations carry only what you ticked (untick Gutters on
     page 2 first if you want to see a line vanish).
   - ✅ An "Exterior - Extras" area exists with a $0 Deck line and a
     "measure on site" item in the review list — the ticked deck can't
     silently disappear.
6. Dark-to-light check: on page 3 pick "Dark to light" — the surface chips
   should show the same names you ticked on page 2 (exterior names included
   on an exterior job).

If any step fails, note which numbered step and what you saw instead.
