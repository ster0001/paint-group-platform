# Wizard + builder batch (Tom, 5 Sep 2026) · what to run and what to check

## Run once on production

`supabase/migrations/20270102000000_garage_litres_and_size_uplift.sql` — paste
into the SQL editor. Read-back: the two Garage Door rows show
`litres_per_item_per_coat = 2.727`, and four "Margin uplift" settings rows
appear (10000 / 0 / 20000 / 0).

## Then type the margin percentages

Settings → Pricing → "Pricing & job numbers": **Margin uplift — tier 1 %**
and **tier 2 %** are 0 until you set them. They apply to the part of the
ex-GST subtotal ABOVE each threshold (so a $25k job gets tier 1 on the $15k
above $10k, plus tier 2 on the $5k above $20k). A job never gets cheaper by
getting bigger. Thresholds are editable too.

## Check in the wizard / editor

1. **Garage door** — an exterior with a garage door now shows 6 L of Dulux
   Weathershield in the builder Materials tab (the work order rounds it to a
   10 L tin). Settings → Pricing → Substrates now has "L / item / coat" and
   "m / L" columns if any other item needs tuning.
2. **Posts and strapping** — in the exterior editor, add Posts or Strapping to
   a side: the tile now has − / + so the count can be set. Every per-item
   row on the rate card behaves this way.
3. **Eaves twice** — on a side that already has Eaves, "+ Eaves (second row,
   upper)" appears in the add panel. Both rows are labelled upper / lower on
   the job sheet and each bills the full side length.
4. **Fence type** — Step 5 of the wizard and the editor's extras card offer
   Paling / Picket (brushed) / Picket (sprayed). The picket rows on the card
   are the ones that price.
5. **Finalise my price** — the bottom bar's button now opens: Call us now
   (your office number), Ask us to call you back (mornings / afternoons / any
   time + mobile), Request a site visit (same, plus "when suits you"). Each
   request lands on CRM → Today as "requested a call" with the note prefixed
   SITE VISIT where relevant, and on the account timeline.
6. **Sheen per item** — builder Materials panel: the sheen dropdown on a row
   changes that surface type only, for this estimate only. The product
   catalogue's default sheen is untouched (edit it in Settings → Products).
   The customer's paint cards split by sheen; the work order carries it.
7. **Measurements from photos** — an exterior built from a floorplan now
   takes each side's length from the plan's printed edges, and a facade
   photo's read height, instead of the fixed 12/14 × 2.6 m. What the photo
   cannot tell us (a width with no reference in the frame) still falls back
   to the typical size, flagged "typical — confirm". Interior room sizes on
   the no-floorplan path are typical by design.
