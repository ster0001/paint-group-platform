# Paint Group — the online estimator, exactly as it works today

*Captured 9 September 2026 by walking the live build end to end. Every screen below has a
screenshot of the same name. This describes what EXISTS, not what's planned.*

Dark theme throughout: near-black background `#0A0B0D`, panels `#12161A`, hairline borders
`#242B32`, text `#EDF0F2`, muted grey `#8C959D`. One accent — cyan `#3BD8E9` — means *chosen* or
*confirmed*. Amber `#E0A83C` means *still to confirm*. Two typefaces: Switzer for words, Martian
Mono for numbers, labels and anything in small caps.

---

## Where it lives

`/estimate`. It sits behind a switch in Settings → Estimates → Online estimates: **off today**, so
the public sees a holding page with a "call me" form. Staff and signed-in customers always get the
real thing. There is no login to start — the visitor gets an anonymous session in the background.

---

## The shape of it

**Four to six question screens, then the estimate builder.** The question screens collect what the
pricing engine needs; the builder is where the customer sees a price and adjusts it. A progress
bar of dots sits top-right on every question screen; a sticky footer holds **Back** and
**Continue** (the last one says *See my estimate*).

Three routes through the questions, chosen on screen 1:

| Route | What it means |
|---|---|
| **Describe it** | The customer types a few lines; AI builds the whole estimate from them |
| **Answer a few questions** | The full form — no floorplan needed, rooms sized from typicals |
| **Upload the floorplan or listing** | A floorplan photo or a real-estate link; rooms and sizes are read from it |

---

# Screen 1 · The property
`01-interior-start.png` · `02-describe-box.png` · `03-interior-p1-property.png` · `11-exterior-start.png`

**Heading:** "Let's look at the place" — *About 90 seconds to your first range — and every answer
can be changed afterwards.*

1. **Job address** — one field, Google Places autocomplete ("start typing and pick it"). Falls back
   to separate Suburb / Postcode fields.
2. **What's being painted?** — three buttons: **Interior · Exterior · Both**.
3. **What kind of property?** — House · Townhouse · Unit / apartment · Commercial.
   - Commercial adds one question: **A few rooms or offices** · **A larger space — whole floor,
     shop or warehouse** · **Strata / body corporate**. The last two hand the job to a person and
     the wizard stops; the first is priced like any interior.
4. **How would you like to do this?** — the three route cards above, each with a line of
   explanation. Picking *Describe it* opens a text box below it (`02`), with a prompt and an
   example. Picking *Upload* reveals the file / listing-URL controls.
5. A small link under the cards: *"Curious what similar homes cost? See real jobs and their prices →"*

> Note for design: the address, job type and property kind are all on this one screen, stacked. On
> a phone it scrolls.

---

# The interior route — screens 2 to 5

## Screen 2 · Surfaces
`04-interior-p2-surfaces.png`

**"What's being painted?"** — *We've pre-ticked the usual full repaint — untick anything that
isn't being done.*

A grid of tick tiles, grouped with small headings: walls, ceilings, cornices, doors, door frames /
architraves, skirting, windows, cupboard doors, staircase and so on. Ticked tiles turn cyan with a
✓ in the corner. Most arrive already ticked.

## Screen 3 · Condition
`05-interior-p3-condition.png`

**"Which describes it best?"** — *Coats first, then any damage — together they set the preparation
we allow for.*

1. Three big cards, each with a small coats label:
   - **1 COAT · Freshen up** — same colours, colour-matched
   - **2 COATS · Change of colour** — new colours throughout
   - **3 COATS · Dark to light** — covering dark colours or stains
   (Choosing *dark to light* opens a follow-up: which surfaces.)
2. **"Any damage we should know about?"** — four cards: *No damage · Only minor cracks or defects ·
   Mostly minor, a few areas of concern · In real need of repair*.
   The last two open a photo attach button and a description box.

## Screen 4 · Details
`06-interior-p4-details.png`

**"A few quick details"** — *Pick what's closest — "mostly" is fine.*

- **What type of doors, mostly?** — picture tiles: Panel · Flat · Not sure · Not applicable
- **And what gets painted with each door?** — Door only · Door + frame
- **Ceiling height** — 2.4 m · 2.7 m · 3 m+ · Not sure
- **What type of windows, mostly?** — picture tiles: Casement · Sash · Colonial · Winder · Not sure ·
  Not applicable (auto-set to Not applicable when windows aren't in scope)
- **Any chance of asbestos sheeting in the areas being painted?** — No · Yes · Not sure
  (*Yes* is a hard stop — no price is shown, an assessment is offered instead)
- **Will anyone be living there while we paint?** — No, it'll be empty · Yes, we'll be living there

## Screen 5 · Your details (+ paint)
`07-interior-p5-contact-and-paint.png`

**"Who should we send your estimate to?"** — name, email, phone, and the paint preferences folded
in below (brand, water-based only, colour help). Contact is deliberately the **last** thing asked.
Button: **See my estimate**.

---

# The exterior route — screens 2 to 5

## Screen 2 · What we're painting
`12-exterior-p2-house.png`

**"What are we painting?"** — *Tick everything that applies — the house, and anything standing on
its own.* Tiles: **The house** (walls, trims, roofline) · Fence · Floor coatings · Deck ·
Garage / workshop / shed · Wall.

If the house is ticked, four more questions appear on the same screen:
- **Single or double storey?** — two illustrated cards (up to 4 m / over 4 m)
- **Roughly how big is the footprint?** — <120 m² · 120–200 · 200+ · Not sure
- **What's the house made of?** — Render · Weatherboards · Brick · Stucco · Cement sheet ·
  Colorbond · Tilt slab / concrete · Other · None (multi-select)
- **Also being painted on the house?** — Windows · Doors · Eaves · Fascias · Gutters & downpipes ·
  Garage door (most pre-ticked)
- **Where are we painting?** — The full exterior · Front · Left side · Back · Right side

*(Ticking anything other than the house adds an extra screen — "A little more on those" — asking
the fence type, shed / wall material, floor area.)*

## Screen 3 · Condition
`13-exterior-p3-condition.png`

**"How's it holding up?"** — *Honest is best — it sets the preparation we allow for.*
- **How's the paintwork holding up?** — Good overall · Weathered · Peeling & flaking
- **Anything tricky about access?** — Steep block · Tight side access · Double-height entry · None
- **Any special access equipment required?** — Scissor lift · Boom lift · Scaffold / platform ·
  None. Ticking one shows a promise that hire and set-up are **not** in the price.

## Screen 4 · Extras
`14-exterior-p4-extras.png`

**"Anything else out there?"** — *The things that are easy to forget.* Pergola, balustrades, and
the paint preferences.

## Screen 5 · Your details
`15-exterior-p5-contact.png` — same as the interior's contact screen.

---

# What happens on "See my estimate"

The answers are priced server-side and the customer lands **straight in the estimate builder** —
there's no in-between results page. Before that, a few answers can divert them:

| Outcome | What the customer sees |
|---|---|
| **Hard stop** | Asbestos suspected, or a pre-1970 home in real disrepair — no price, an assessment offered |
| **Hand-off** | Commercial (larger / strata), heritage, body corporate — "a person will price this" |
| **Outside our area** | A polite exit based on the postcode |
| **Under the minimum** | A minimum-job message |
| **Reveal** | The builder, below |

---

# The estimate builder

Two versions, chosen by the job: **rooms** for interior or both, **sides** for exterior only.

## Interior — the room builder
`08-builder-interior-phone.png` · `09-builder-interior-desktop.png` · `10-builder-room-card-open.png`

**A frozen header** that never scrolls away:
- a **confidence score** ring (a %) with the tier chip beside it — BRONZE / SILVER / GOLD — and a
  line saying what would lift it
- **YOUR ESTIMATE · INCL. GST** and the range, e.g. *$5,120 – $5,560* (always a range, never a
  single number)
- a progress bar: *3 OF 9 CONFIRMED · ORANGE = TO CONFIRM · BLUE = CONFIRMED*
- the floorplan and photos on file, pinned (a strip on a phone, a column on a laptop)

**The body** is a stack of cards, one per room, each amber until confirmed and cyan after:
- *"This room's about 4.2 m × 3.6 m — sound right?"* → **Looks right** / **Adjust it** (L × W in
  metres, never m²)
- the surfaces in that room as tiles, each removable, counted items with − / + steppers
- cupboard questions where the room type has them
- **+ Add a surface to this room** — opens a panel of everything on our rate card, grouped
- a free-text *"Something else in this room? Name it"* — flagged, never auto-priced
- **Confirm this room ✓**

Then three whole-job cards: **doors & windows totals**, **anything we haven't listed** (a sweep),
and the missed-rooms check.

**A sticky footer**:
- a line saying why a person is involved, if one is
- the range again
- the main button — **Finalise my price** (or **Accept estimate** when the job qualifies), always
  clickable, with a line under it: *"You don't have to finish first — 3 of 9 confirmed."*
- **Book in your estimator** — three icon buttons: *Book a site visit* · *Call us <number>* ·
  *Request a call back*, plus the office hours

A **chat bubble** sits bottom-left on every screen — a direct line to a person, not the AI.

## Exterior — the sides builder
`16-builder-exterior-phone.png` · `17-builder-exterior-desktop.png` · `18-builder-side-card-open.png`

Same header and footer. The body is different:
- a **plan of the house from above**, with the four edges tappable and colour-coded (amber = to
  confirm, cyan = confirmed, grey dashed = not painting)
- eight cards: **Front · Left · Right · Back**, then **Freestanding extras · Condition & access ·
  doors and windows · a last sweep**
- each side card asks: *Are we painting this side?* → *This side's about 12 m long × 2.6 m high —
  sound right?* → the wall materials with a **% of wall** control → *Also on this side* tiles
  (with metre boxes on runs like gutters and handrails) → an optional **notes and photo box** →
  **Confirm ✓**
- a **Rename** control on each side, so "Left side" can become "Courtyard"

---

# Things worth knowing for the redesign

- **The customer always sees a range**, never a fixed price, and the range narrows as the
  confidence score rises.
- **Every tap re-prices** server-side and the range updates live, with a small toast saying what
  changed and by how much.
- **Amber → cyan** is the language of the whole thing: amber means we assumed it, cyan means you
  told us.
- **Nothing is a dead end.** Book a visit, call, or ask for a call back from any screen of the
  builder.
- **Exterior never accepts online** — an estimator signs off every exterior job.
- Roughly **25–30 answers** before a price today, then another 20–30 taps to confirm everything.
