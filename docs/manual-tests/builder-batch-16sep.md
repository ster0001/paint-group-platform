# Manual test — builder batch, 16 Sep 2026 (option tick, title = address, add a paint)

No migration. Deploys with the code.

## 1. The option tick

1. Open a draft estimate, click a room to see its substrates.

Expect: every substrate row starts with a small tick box labelled "Option",
before the folder icon.

2. Tick it on the Doors row.

Expect: the row greys with an "Optional" tag, the room's price drops by the
doors' price with "+ $X optional" under it, and an OPTIONAL row appears
under TOTAL. Back on the list, "Lounge — Doors" sits under Optional extras.
Untick: everything returns.

## 2. The title follows the address

1. On a new estimate, type a title of your own, then choose a job address
   in the header and press Save.

Expect: the title becomes "street, suburb" (e.g. "12 Smith St, Clayton"),
in the header and on the Estimates list. Change the address and Save again:
the title follows.

## 3. Add a paint the customer should see

1. In the Materials card at the top of the builder, under "Also shown to the
   customer", choose a primer or stain blocker from the list and press
   **+ Add a paint**. Type a note such as "Stain blocking on the ceiling".
2. Save, then open the Estimate tab (or the customer link).

Expect: the product has its own card under "The paint we're supplying" —
under "Preparation products" when it is one — with your note as its chip.
Nothing is added to the price. × on the row removes it.
