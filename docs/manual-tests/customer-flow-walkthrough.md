# The 90-second phone walkthrough — R5 acceptance script

Run both paths on your phone, mockup beside build. Anything that diverges:
screenshot it → punch-list item → fix before proceeding. (Rebuild plan v2 §R5.)

Sign in as staff first (staff preview now gets EXACTLY the customer payload —
that's R1.1, and it's why testing as yourself is finally trustworthy).

## Path A — interior (no plan), ~90 seconds

1. Open `/estimate`. Tap **"There isn't a floorplan to hand"** → the basics
   appear. Suburb `Murrumbeena`, postcode `3163`, Heritage **No**, kind
   **House**. → *Continue.*
2. Page 2: surfaces pre-ticked (walls/ceilings/cornices/doors/architraves/
   skirting). → *Continue* → page 3 condition → *Continue* → page 4: leave the
   door/window styles UNTOUCHED (this is deliberate — R1.2), built before
   1970 **No** → *Continue* → page 5 → *Nearly there* → email → **See my
   estimate**.
3. Result: a RANGE (never a point price), accuracy **no higher than 65%**
   (honesty cap — nothing is verified yet). Tap **Open the editor**.
4. The confirm loop: header reads **N OF M CONFIRMED** with an amber bar;
   every room card is amber with **CONFIRM THIS ROOM**.
   - Tap **Confirm** on a room WITHOUT answering — it must shake and name
     the missing question. Never a silent pass.
   - The size question reads **L × W in metres** ("Is 3.5 × 3.25 m about the
     size?") — m² must appear NOWHERE customer-facing.
   - **Adjust it** on one room → two metre inputs → Update size → header
     shows "updated by you", the range moves.
   - Doors tiles are ON with steppers, and carry an amber **style to
     confirm** chip (you never answered page 4 — they still priced at the
     default rate; nothing you told us exists contributes $0 silently).
   - Kitchen card asks **"Are we painting the kitchen cupboards?"** (after
     you run migration 20260920) — Yes shows the 14-front stepper and the
     spray-finish note; No is a recorded answer.
   - Type something odd into **"Something else?"** ("wall panelling") — an
     amber ⚑ tile appears, the toast says we'll confirm it on the site
     visit, and the CTA later reads book-the-visit (custom = never
     auto-priced).
5. Confirm every room → each turns cyan and the next opens. Then the
   **doors & windows totals check** ("We make it N doors and M windows…"),
   then the **sweep** — the FIRST chip must be **Hallway**.
6. All blue: header flips to **ESTIMATE CONFIRMED ✓**, the CTA enables.
   At ≤65% accuracy it must read **"Confirm my price — book the visit"** —
   tap it, pick a slot, see "Visit booked".

## Path B — exterior, ~90 seconds

1. `/estimate` → tap **Exterior**. There must be NO floorplan upload and NO
   "no floorplan" link anywhere — paste a listing URL (or add 2 facade
   photos). Suburb/postcode/heritage/kind as above. → *Continue.*
2. Page 2: **single/double storey** pictures + **"What's the house made
   of?"** (weatherboard pre-ticked). → page 3: **"What are we painting?"**
   with the roofline PRE-TICKED — and NO "how far around" question (sides
   replace it). → page 4: condition cards + built-before-1970 + access
   chips — NO ceiling heights, NO interior door styles. → page 5: extras
   (fence takes metres or "not sure") + paint brands. → email → submit.
3. Editor: the **top-down house** with four amber edges; eight cards:
   Front / Left / Right / Back / Freestanding extras / Condition & access /
   windows-doors check / sweep. Progress **0 OF 8**; CTA disabled.
4. Front: **"Are we painting this side?"** → Yes → the L × H question
   ("about 12 m long × 2.6 m high — sound right?") → the walls grid shows
   ONLY weatherboard (your page-2 answer) at 100%. **+ Add a surface** →
   **+ Render — wall surface** → it arrives at 25% and weatherboard drops
   to 75% (auto-balance toast). Set a % so the mix ISN'T 100% and tap
   confirm — it must refuse with the exact number. Fix it, confirm → the
   card AND its edge on the house turn cyan.
5. Right side: **No — skip this side** → pill reads **NOT PAINTING ✓**,
   edge goes grey-dashed, and it counts as done (it'll be an explicit
   exclusion on the quote).
6. Back: **Adjust it** → type "not sure" in length → accepted, "(we'll
   measure)" shows, range widens.
7. Finish extras / condition (say **Quite a bit** of rot — the toast says
   rot needs eyes on it and the tier line flips to the visit) / the totals
   check / the sweep. **8 OF 8** → CTA enables → book the visit.

## What must NEVER appear

Hours, rates, prep times, margins, or a point price on any customer screen;
m² anywhere customer-facing; a blocked state with no path forward; a $0 line
for something you said exists.
