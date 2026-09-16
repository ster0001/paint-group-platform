# Manual test — optional substrates inside a room (16 Sep 2026)

No migration. Deploys with the code.

## 1. Make the doors an option

1. Open any draft estimate in the builder. Click a room (say the Lounge) to
   see its substrates.
2. On the Doors row, press **Option** (right-hand end of the row, next to ⧉).

Expect: the row greys out with an "Optional" tag and the button now reads
**Include**. The room's price at the top right drops by the doors' price and
shows "+ $X optional" under it. Under the TOTAL row a new OPTIONAL row shows
the doors' hours and price on their own.

3. Press **Option** on Architraves and Skirting too.

Expect: all three greyed; the OPTIONAL row is the sum of the three.

## 2. Back on the list

Press **← All areas**.

Expect: the Lounge card shows the included price with "+ $X optional"
beneath it, and its subtitle names the optional substrates. A card
"Lounge — Doors, Architraves, Skirting" sits under **Optional extras** with
that price. The estimate total (right-hand card) does not include it.

## 3. Customer view

Switch to Customer view (or Save and open the customer link).

Expect: the Lounge lists Walls and Ceilings only, priced without the
trims. Under Optional extras: "Lounge — Doors, Architraves, Skirting" with
"+ $X". Ticking it adds the line to the quote table and lifts the total by
$X plus GST. Unticking removes it.

## 4. Accept with the option ticked

Accept as the customer with the option ticked.

Expect: the accepted total includes it and the final invoice carries a
"Lounge — Doors, Architraves, Skirting (selected option)" line.

Note (unchanged behaviour): the work order's job sheet is frozen from the
INCLUDED scope, so add the accepted trims to the job by hand, as with an
optional area today.

## 5. One button back

In the builder, on the Optional extras card press **Put back in the
estimate**.

Expect: the card disappears, the Lounge price is the whole room again and
the three rows are no longer greyed.
