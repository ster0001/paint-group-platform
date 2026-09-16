# Manual test — optional substrates inside a room (16 Sep 2026)

Run `supabase/migrations/20270149000000_wo_apply_selected_options.sql` in the
Supabase SQL editor first (§4 and §6 need it; §1–3 and §5 do not). Its tail
lists the five functions it made — expect five rows.

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
"Lounge — Doors, Architraves, Skirting (selected option)" line. Open the
job (Projects → the work order): the Lounge on the job sheet lists Doors,
Architraves and Skirting after Walls and Ceilings, the materials carry their
paint, the contractor payment is the higher figure, and the painter's tick
list has a row for each. (The estimate must have been SAVED by the new
builder before it was sent — that save writes the option's job-sheet piece.)

## 5. One button back

In the builder, on the Optional extras card press **Put back in the
estimate**.

Expect: the card disappears, the Lounge price is the whole room again and
the three rows are no longer greyed.

## 6. The customer asks for the option after accepting

1. Accept an estimate WITHOUT ticking its option. Open it in the builder.

Expect: a panel "Options on this accepted job" lists the option with an
**Add to job** button.

2. Press **Add to job**.

Expect: "Added — it is on the work order, the tick list, the accepted total
and the final invoice." The row reads "On the job ✓". The accepted total on
the estimate has risen by the option's price plus GST (less the quote's
percentage discount, if any). The work order's job sheet and tick list now
carry the option's surfaces. If a draft final invoice existed it has been
re-drafted with the line; an issued one is untouched and the balance shows
the difference.

3. Press nothing twice: the button is gone; the panel stays as the record.
