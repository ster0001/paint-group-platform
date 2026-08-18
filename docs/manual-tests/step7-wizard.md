# Manual test — Step 7 internal wizard

_Sign in as `pg.sam.staff@gmail.com` (password `painttest123`)._

## Before you start (one-off)

1. In the Supabase SQL editor, run
   `supabase/migrations/20260915000000_wizard_source.sql`
   (lets the wizard tag estimates `source='wizard'`; until then it saves with
   the old tag and shows a note in the editor).
2. In a terminal:
   `npx tsx scripts/seed-extraction-settings.ts`
   (adds the kitchen and hallway typical sizes the starter list uses — both
   editable afterwards in Settings).

## The no-plan path (5 minutes)

1. Estimates → **+ New estimate** → **Start with the wizard**.
2. Page 1: type a job name, tap **There isn't a floorplan to hand** —
   the basics appear. Pick 3 bedrooms, Single storey, "Yes — one big space".
   Continue.
3. Page 2: the usual repaint is pre-ticked. Untick **Windows**, Continue.
4. Page 3: pick **Dark to light** — a follow-up asks which surfaces; it only
   offers the ones you ticked. Pick Walls. Continue.
5. Page 4: pick **Panel** doors, **2.7 m**, any window style, and damage
   level 3 — it asks for photos and a description; type a description only.
   Continue.
6. Page 5: tick **Water-based only** — it asks about oil trims; pick
   "Yes — oil-based". Tap **See the estimate**.
7. **Check the editor:** every room says "typical size — confirm"; the
   Kitchen / Living room is there at 36 m²; walls say 3 coats, ceilings 2
   (tap a room to see them); no window lines anywhere; the notes strip lists
   the oil-trim conversion and your damage description.
8. Tap a bedroom → **Confirm size** — the chip flips to ✓ CONFIRMED and the
   accuracy percentage rises. Tap **+ wc** — a toilet appears, priced; the
   total moves. Remove it — the total moves back.
9. **Open in the builder** — the same rooms are there, and repricing in the
   builder matches the wizard's total.

## The floorplan path (needs a real plan image/PDF)

1. New wizard → upload a floorplan on page 1 (keep answering while it reads).
2. Pick a stated ceiling height (not "Not sure") on page 4.
3. After **See the estimate**: rooms carry "READ FROM THE PLAN"; the plan
   image is pinned on the left; rooms the plan didn't dimension say
   "no measurements — priced at $0" and want a size before confirm.
4. Pick "Not sure" for height on another run: an amber **confirm height**
   chip appears in the editor; confirming it repriced every room.

## What should refuse

- Page 1, "Both" without a listing URL: it asks for 2–3 facade photos before
  continuing.
- Page 3, dark-to-light with nothing picked: it won't continue.
- Page 4, damage level 2+ with no photos and no note: it won't continue.
