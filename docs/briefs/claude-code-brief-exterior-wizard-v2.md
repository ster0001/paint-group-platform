# Claude Code brief — Exterior wizard v2: build your house, walk around it, accurate at the gate

**Status:** v2.2, 12 Oct 2026 (after Tom's seven-point review and his follow-ups: one material unless double storey; a per-side confirm before the gate; an end-of-row option for terraces, townhouses and units). Ready to build once Tom has checked the mockup on his phone. No ⚑ blocks the build — every open decision has a safe default (§12).
**Builds on:** the wizard UI refresh (merged, S9 = PR #252), so the new screens use the refresh's shell, tokens, pictures and two-column layout.
**Mockup:** `design/reference/exterior-wizard-redesign-mockup.html` (phone-first; the "Try" buttons in the mock bar load a bungalow, a townhouse and a period terrace).
**Repo state read:** `main` at `837f6115` (12 Oct 2026).

---

## 1. Plain-English summary

Today an outside job asks six tick boxes, a wall material, a window type, a count, a colour, storeys and access, then "which sides", then the gate. The range behind the gate is priced on a house that is **always 12 m across, 14 m deep and 2.6 m high** (5.5 m for two storeys), with one wall material, no gables, no verandah, no posts, and a condition spread from "good" to "peeling". The sides editor after the range is where the customer first gets to correct any of it.

The new flow keeps the shape every Paint Group estimate has — **quick questions → details → a guide range → tighten it, or book a visit** — but draws the customer's house and prices the drawing:

1. **What kind of home is it?** Nine shape cards (weatherboard home, Californian bungalow, brick veneer, double-storey, townhouse, unit or villa, period terrace, modern home, something else) plus a rough size. A shape that usually shares walls (terrace, townhouse, unit) also asks **where it is in the row** — in the middle, end of the row with the left or right side open, or standing alone — so an end of terrace gets its side wall. The shape sets the silhouette, the typical sizes, which sides are shared, and whether the walls are usually painted at all. It does not decide the material.
2. **Tap everything we're painting.** The house is drawn beside the questions. Every part the home *has* is on it in grey — walls, gable ends, fascias, gutters, downpipes, eaves, windows, doors, garage door, shutters, verandah with posts/columns, verandah ceiling, handrail — and lights up when ticked, on the chip or on the picture itself. Around the house: fences, deck, pergola, shed, boundary wall, side gate, meter box, security door. Nothing about materials yet.
3. **Tell us about what you ticked.** Only for the ticked parts: what the walls are made of — **one material for a single storey; downstairs and upstairs for a double storey** (painted or bare brick; vertical timber is stained) — what's in the gable, the window type (the drawing changes), single or double garage, posts/columns/iron lace, rough sizes for the extras. Then **colours** and **access**. All of this is before the gate.
4. **Check each side.** Front, right, back, left, with the picture turned to that side. Each side starts with what was ticked for the house, in plain chips: untick what isn't on that side, add anything that is (a gable on the side, a porch at the back), change the material if that side differs, or mark the side "not painting" (shared sides start that way). One tap — *Looks right — next side* — confirms it. No sizes or counts yet.
5. **Details → the guide range**, priced on the drawn house, side by side as confirmed, at the shape's typical sizes. The range screen's first door is **Tighten my price**; the others are Book a site visit, Speak with us, Send us a message.
6. **Tighten = walk around the house again**, one side at a time, now for the numbers: the same per-side list is there to change, plus the window and door counts, whether the typical size looks right (or adjust it, or not sure), and how the paint is holding up. Each side turns blue. The range becomes **Detailed**, with a row per side showing exactly what was counted. Tom still confirms every outside price before it is fixed; scaffolding and lifts stay excluded.

What this does to accuracy: the biggest errors today are the size (a 7 m townhouse and a 16 m bungalow both price as 12 × 14), the missing parts (a bungalow's gable, verandah, posts and ceiling can be a third of the job), two materials collapsing to one, and the condition spread. The guide range now carries the right shape, size band, and the parts and materials confirmed side by side; the tighten step closes the sizes, the counts and the condition. It does **not** change the pricing engine — every line still prices through `lib/pricing` at the live rate card. What changes is the area tree the wizard hands it.

It is not a huge build: one new pure module that turns the answers into side-by-side area nodes, one parametric picture component, four quick screens and the tighten screen, a small reference table of typicals, and the specs and help that go with them. Six sessions.

---

## 2. What is wrong today (verified in the repo)

| # | Finding | Where | Effect on the number |
|---|---|---|---|
| 1 | Every side is sized 12 m (front/back) or 14 m (sides) × 2.6 m (5.5 m double). The footprint band that could scale it (`SIZE_BAND_FACTOR`) is never set by the customer quick look — only staff mode writes `exterior.sizeBand`. | `lib/wizard/exteriorAnswers.ts` L170–200; `lib/wizard/starter.ts` L170; `app/wizard/WizardApp.tsx` L3341 | A narrow townhouse over-prices; a large bungalow under-prices. Wall area, fascias, gutters and eaves all scale with it. |
| 2 | Two wall materials collapse to one: `scaffoldCladdingCode` returns weatherboards if ticked, else render, else … — the `sharePct` split only exists in the sides editor after the range. | `lib/wizard/starter.ts` L304–313; `lib/wizard/sides.ts` (sharePct) | Brick base + boards, render ground + boards upper (very common in Melbourne) price as one material at full height. |
| 3 | No way to say the house has a gable, a verandah, posts/columns, a verandah ceiling, a handrail, shutters, strapping or downpipes before the range. The rate card has rows for all of them (`Posts`, `Columns`, `Soffits / Exterior Ceilings`, `Hand Rails`, `Wood Shutters`, `Strapping`, `Downpipes`, `Stucco`). | `lib/wizard/exterior-quick-look.ts` `EXT_ELEMENTS`; `supabase/seed/ratecard_v7.sql` L195–213 | A Californian bungalow's gable (stucco or shingles), verandah ceiling and columns are missing from the range entirely. |
| 4 | Window and door counts are whole-house and spread evenly round four sides (`spreadOverSides`); one window type "mostly". | `lib/wizard/starter.ts` L349 | Fine on average, wrong per side; the sides editor re-asks after the range. |
| 5 | Condition is asked once for the whole house, as the first tighten question (Tom, 15 Sep); before that the range spans sound → peeling, which is the `COND-POOR` ×1.35 labour multiplier on the dear end. | `lib/wizard/envelope.ts` `conditionOpen`; `lib/wizard/exteriorAnswers.ts` `applyConditionPricing` | A ±15% size band *plus* a 35% condition spread: the guide range on a $20k job is roughly $15k–$27k. The tighten step now asks it per side, which also tells the painter which sides are peeling. |
| 6 | Vertical timber cladding (stained, not painted) has no door in: it is priced as "Cladding or panelling → Colorbond". The card has a `Cutek` staining row. | `exterior-quick-look.ts` `EXT_MATERIALS` (panelling → colorbond) | Wrong product, wrong rate. |
| 7 | **Rate card:** `EXT-WEATHERED` is a ×1.8 labour multiplier; `COND-POOR` (peeling/flaking) is ×1.35. "Worst wins", so a *weathered* house prices 33% dearer than a *peeling* one. | migration `20260922000000_real_extras_prices.sql` L55; `ratecard_v7.sql` L39 | Not fixed by this brief — a rate card ruling (⚑ 6). The mockup uses good 1.0 / weathered 1.2 / peeling 1.35 for illustration only. |
| 8 | Walls are priced on the full rectangle L × H with no gable triangle and no deductions for openings. | `lib/pricing/estimate.ts` `computeQuantity` (surface areas: `L * H * share`) | Gables under-price; openings are the house convention (no deduction) — keep (⚑ 15). |
| 9 | Brick: "Painted brick" (`Brick`) and bare brick (`Brick (Unpainted)`, 3 coats) are different rows; the quick look only offers "Brick". | `lib/wizard/sides.ts` `WALL_CODES` | Bare brick under-prices by a coat and a sealer. |

The elevation-source rule in `lib/extract/exterior.ts` ("every envelope number comes from an elevation source … no reference, no number") was written for photo and plan reads. The from-answers path (`noPhotos: true`) already prices typicals tagged `assumed`; this brief keeps that discipline — every number the customer did not confirm stays tagged, and the sides editor and the estimator still see what was assumed.

---

## 3. Reference files

**Read first**
- `design/reference/exterior-wizard-redesign-mockup.html` — the screens, the picture, the per-side behaviour. Its price numbers are illustrative only.
- This brief.
- `docs/briefs/wizard-ui-refresh-components.md` — tokens, shell, controls and the picture components the new screens reuse.
- `docs/briefs/claude-code-brief-c8b-exterior-quick-look.md` — the current exterior quick look and Tom's 11–15 Sep rulings it records.
- `docs/briefs/estimator-v2-parking-lot.md` — append findings here, never fix in passing.

**Code the build changes**
- `lib/wizard/exterior-quick-look.ts` — `ExteriorQuickLook`, `applyExteriorQuickLook`, `exteriorQuickLookFromState`, `exteriorRestatement`, `exteriorAssumedList`.
- `lib/wizard/state.ts` L411–498 — the `exterior` schema.
- `lib/wizard/exteriorAnswers.ts` — `applyExteriorAnswers` (the 12/14 × 2.6/5.5 sizing), `applyConditionPricing`.
- `lib/wizard/starter.ts` — `starterExteriorNodes`, `scaffoldCladdingCode`, `spreadOverSides`, `EXTERIOR_WINDOW_CODE`, `CLADDING_CODE`, `exteriorExtrasNodes`.
- `lib/wizard/quick-look.ts` — `stepsFor()` (exterior: `start, place, outside, sides, gate`).
- `lib/wizard/envelope.ts` — the range envelope (`conditionOpen`, `confirmedShare`).
- `app/wizard/QuickLook.tsx` L522–648 (the `outside` and `sides` steps), `app/wizard/ExteriorTiles.tsx`, `app/wizard/pictures/OutsideHousePicture.tsx`, `app/wizard/WizardApp.tsx` (the outside state plumbing).
- `app/estimate/scope/SidesEditor.tsx` and `lib/wizard/sides.ts` — the after-range sides editor; it must read v2 answers and re-ask nothing.
- `lib/wizard/policy.ts` — guardrails; the quick look leaves `builtPre1970: "unsure"` (hazmat is on the estimator's site checklist by ruling — do not add a pre-1970 question).

**Code the build must not change**
- `lib/pricing/**` — the engine. Quantities are expressed through the existing surface fields (`measureL`, `measureH`, `qtyOverride`, `count`, `sharePct`); no new pricing math anywhere else (CLAUDE.md).
- `lib/extract/**`, `app/api/**` beyond reading the new fields, `proxy.ts`.

**Data**
- `supabase/seed/ratecard_v7.sql` L189–219 — the exterior rows the parts map to. Migrations `20260921000000_exterior_extras_rates.sql` (Side Gate $120, Security Door $90, Meter Box $35, Shed $640, Window Shutters $240) and `20260922000000_real_extras_prices.sql` (`EXT-WEATHERED`).
- `room_type_defaults` (interior typicals, read in `lib/agent/scope-store-supabase.ts`) — the pattern for the new exterior typicals table.

**Tests that cover the current exterior path and will change**
`e2e/customer-journey/exterior-quick-look.spec.ts`, `exterior-path.spec.ts`, `exterior-batch-15sep.spec.ts`, `sides-editor.spec.ts`, `both-stacked.spec.ts` (outside half), `outside-commercial.spec.ts` (must NOT change — commercial outside stays a brief); unit: `lib/wizard/exterior-quick-look.test.ts`, `exteriorAnswers.test.ts`, `envelope.test.ts`, `sides.test.ts`.

**Help**
`docs/help/estimator/customer.md` (outside sections), `docs/help/estimator/staff.md` (what the estimator now receives), `npm run help:index -- --check`.

---

## 4. Rulings that stay in force

- **The same shape as every other estimate:** quick questions → details gate → a guide range → Tighten my price / Book a site visit / Speak with us / Send a message (Tom, 12 Oct). The walk-around is the tighten step, not a pre-gate step (⚑ 0 records the alternative).
- No price before the details gate for a home.
- Guide / Detailed / Confirmed are accuracy labels, not rewards (Ruling G). No gamification.
- Every outside price is confirmed by a person before it is fixed. The range screen says so; the four doors stay. Once every side is checked the Tighten door becomes "Change a side" (⚑ 14).
- Scaffolding, lifts and rotten-timber replacement are excluded, never priced, and the range says so.
- Nothing is pre-ticked (C8b), and **elements before materials**: what is being painted is asked before what it is made of, and a material is only asked for a ticked part (Tom, 12 Oct).
- Colours and access are asked before the gate, with the other quick questions (Tom, 12 Oct).
- A side the customer leaves off is not on the estimate at all (Tom, 8 Sep); a side opened and skipped is "not painting" on the quote.
- Double storey, outside-only = the `ACC-2STOREY` ×1.15 modifier (Tom, 15 Sep); "both" keeps the per-side hours.
- Pergola is priced on its top's footprint (Tom, 5 Oct).
- Picket vs paling fence is a 10× labour difference and stays its own tick.
- Condition is asked on the tighten step, after the range (Tom, 15 Sep) — now per side rather than once.
- Hazmat (lead, asbestos) is on the estimator's site checklist, not a wizard screen. The quick look keeps `builtPre1970: "unsure"`.
- Light theme only; the refresh's tokens, header, footer, two columns ≥ 901 px.
- Commercial outside work stays a brief + booking (`outside-commercial.spec.ts`) — untouched.
- "Both" jobs: inside first, then the outside half uses these new screens; the after-range editor stays stacked (`both-stacked.spec.ts`).

---

## 5. The model — answers to priced lines

### 5.1 Home shapes and their typicals (⚑ 2, ⚑ 3)

The shape is the house's silhouette and sizes. **It never decides the wall material** — that is asked on About it for the ticked walls, and the picture's texture follows the answer (Tom, 12 Oct: Colorbond, vertical cladding and cement sheet are materials, not houses).

A new reference table `exterior_typicals` (versioned like `room_type_defaults`, seeded by script, RLS on, read-only to `anon`/`authenticated`, Settings-editable later). One row per shape:

| key | Name on the card | storeys | roof | front m | side m | wall h m | gable rise m | usual walls (the picture's starting texture) | walls usually painted | shared sides | verandah |
|---|---|---|---|---|---|---|---|---|---|---|---|
| wb | Weatherboard home | 1 | hip | 11 | 14 | 2.7 | — | weatherboards | yes | — | porch |
| cal | Californian bungalow | 1 | gable | 12 | 16 | 3.0 | 2.4 | weatherboards | yes | — | yes (columns) |
| brick | Brick veneer home | 1 | hip | 12 | 15 | 2.5 | — | brick | **no** (trims only) | — | no |
| ds | Double-storey home | 2 | hip | 12 | 14 | 5.6 | — | render over brick (storey split) | yes | — | no |
| th | Townhouse | 2 | hip | 7 | 14 | 5.6 | — | render | yes | left, right | no |
| unit | Unit or villa | 1 | hip | 9 | 12 | 2.5 | — | brick | no | left | no |
| terrace | Period terrace | 1 | parapet (cornice, pediment, chimney pots) | 6 | 16 | 3.6 | 0.9 (parapet) | render | yes | left, right | yes (iron posts and lacework) |
| modern | Modern home | 1 | skillion | 12 | 14 | 3.0 | 1.1 | cement sheet / panel | yes | — | no |
| other | Something else | 1 | hip | 12 | 14 | 2.7 | — | weatherboards (placeholder, flagged) | yes | — | no |

These are **my proposed numbers** from typical Melbourne stock; they are placeholders until Tom replaces them (⚑ 2). The size answer scales the front and side lengths by footprint: `footprint = m² ÷ storeys`, `front = √(footprint ÷ (side/front ratio))`, `side = front × ratio`, rounded to 0.5 m. Size bands: Small ≤120 m² (use 100), Medium 120–200 (160), Large 200–300 (250), Very large 300+ (340), Not sure (160, flagged). A double storey keeps one wall height for both floors.

The wall materials offered (all rate rows on the card): weatherboards, render, brick (painted / bare), stucco, cement sheet / panel, Colorbond / metal, vertical timber (stain → `Cutek`), tilt slab / concrete. **One material per house on a single storey; a double storey asks downstairs and upstairs** (Tom, 12 Oct) — there is no "brick base" split any more. Any side can override its material on the Each side step (downstairs and upstairs separately on a double storey).

### 5.2 Parts → rate rows → quantity

All quantities are written onto the existing surface fields so `lib/pricing` prices them unchanged. `w` = the side's confirmed width, `h` = its height, `rise` = the type's gable rise.

Every part can be on any side: a whole-house tick lands on its default sides (gable → the gable sides; verandah, posts, ceiling, handrail, garage, shutters → the front; everything else → all four), and the tighten step can remove it from a side or **add it to any side** from the full list, and give a side its own wall material.

| Part (chip) | Rate code | Unit on card | Quantity per side | Notes |
|---|---|---|---|---|
| The walls (the house's material, or this side's own) | `Weatherboards` / `Render` / `Brick` / `Brick (Unpainted)` / `Stucco` / `Cement Sheet` / `Colorbond Cladding` / `Cutek` (vertical timber, stain) / `Concrete / Tilt Slab` | M2 Per Hour | single storey: `w × h` via `measureL = w`, `measureH = h`; a terrace front adds the parapet `w × 0.9` | `Brick (Unpainted)` when the customer says the brick has never been painted (3 coats, card default). `Cutek` for vertical timber unless they tell the estimator it is painted. |
| The walls — double storey, downstairs and upstairs | as above, one row each | M2 Per Hour | `w × h ÷ 2` each; one row when upstairs is "same as downstairs" | Storey heights are equal halves of the wall height (⚑ 18). |
| Gable ends | `Stucco` / `Weatherboards` / `Strapping` (+ the fill) / shingles (⚑ 4, no row) | M2 (or Hours Per Item for strapping) | A full gable (gable-roof shape, front/back): `½ × w × rise`. A gable added to any other side (a cross gable): `½ × 0.5w × 1.9`. Strapping = 1 item per gable | Shingles: a placeholder line at $0 with a deferral "shingles — priced by your estimator", shown on the range as "not in this number", until a row exists. |
| Fascias | `Fascias` | Lineal Metres | `w` on eave sides, plus the rake `2 × √((gw/2)² + rise²)` for any gable on the side (barge boards); a full gable side is the rake only; a terrace front is the cornice and mouldings at `w` | ⚑ 7. |
| Gutters | `Gutters` | Lineal Metres | `w` on eave sides; 0 on a gable side (plus `w × 0.8` if a verandah with its own gutter is ticked on the front) | ⚑ 7. |
| Downpipes | `Downpipes` | Hours Per Item | 1 per side, 2 when `w > 10` (customer can change in the editor) | ⚑ 11. |
| Eaves | `Eaves` | Lineal Metres | `w` | As today. |
| Windows | `Awning / Casement Window` (casement, winder) / `Double Hung Sash` / `Colonial / Bay Window` / `Fixed / Picture Window` (not sure) / none (aluminium, deferred) | Hours Per Item | the side's count (default from the width until the tighten step) | Type chosen once on About it; count per side on the tighten step. Winder and not-sure keep their existing deferrals. |
| Doors | `Front Door` (one, on the front) + `Standard Door (1 Side)` | Hours Per Item | the side's count | As today, per side. |
| Garage door | `Garage Door (1 Car)` / `Garage Door (2 Car)` | Hours Per Item | 1, front only | |
| Verandah — posts / columns / iron lace | `Posts` / `Columns` / `Posts` + a lacework deferral (⚑ 8) | Hours Per Item | `max(2, round(w × 0.8 ÷ 2.6) + 1)` | ⚑ 8. Editable in the editor. |
| Verandah ceiling | `Soffits / Exterior Ceilings` | M2 | `w × 0.8 × 2.4` | 2.4 m depth assumed (⚑ 8). |
| Handrail / balustrade | `Hand Rails` | Lineal Metres | `w × 0.8` | |
| Window shutters | `Wood Shutters` (or the `Window Shutters` extras row — ⚑ 9) | Hours Per Item | `2 × front windows` | |
| Around the house | `Paling Fence` / `Picket Fence (Hand Paint)` (lm, stated metres) · `Deck Painting` (m², stated) · `Pergola` (footprint, as today) · `Shed` ($640) · boundary wall (`Render`/`Brick` × stated m × 1.8 m, as today) · `Side Gate` · `Meter Box` · `Security Door` | | | Picket defaults to hand paint (`picket_hand`), as today. |

Condition and access are unchanged *in pricing*: weathered → `EXT-WEATHERED`, peeling → `COND-POOR` (worst wins), ticked access → `Access Allowance` line, double storey → `ACC-2STOREY`. What changes is that condition is asked per side on the tighten step (⚑ 1), which also fills `peelingSides` for the work order.

### 5.3 The guide range, then the detailed range

`envelopeFor` already narrows by `confirmedShare` (the share of tracked areas confirmed) and opens the condition spread while `exterior.condition` is null. Nothing new is invented; the same policy runs on a better tree.

- **At the gate (guide):** every painted side is a node at the shape's typical size (`assumedFields: L, H`), with the ticked parts, the house material(s) with the split, the default window and door counts by width, and the extras. The band is the wide setting plus the open condition spread — honest, but already the right house. Expected: ±15–21% in the mockup's illustration.
- **After the tighten step (detailed):** a side the customer said "Looks right" or adjusted is confirmed (its node loses `L, H` from `assumedFields`); a side answered "Not sure" keeps its typical size, stays assumed, and counts as unconfirmed (so the band stays wider); condition answered per side closes the condition spread for that side. The headline tier reads **Detailed** when `bandPct ≤ midPct` from `BandSettings` (today 8%), else **Guide**. Expected: ~±4% with all four sides checked, ~±8% with one "not sure".

The mockup's dollar figures are illustrative; the build uses the live card.

### 5.4 What the estimator receives

Unchanged shapes: `Exterior - Front/Left/Right/Rear` area nodes (now with real `L`, `H` and `assumedFields` only where the customer did not confirm), `Exterior - Extras`, `Exterior - Access`, the deferrals list. New deferrals: `exterior_type_unsure` (type "something else"), `exterior_shingles` (⚑ 4), `exterior_size_unsure:<side>`. The quote, work order and job sheet need no change — they already read these nodes.

---

## 6. State

Add to `exterior` in `lib/wizard/state.ts` (all optional, so older sessions resume):

```ts
v2: z.object({
  propertyType: z.enum(["wb","cal","brick","ds","th","unit","terrace","vt","cb","sheet","other"]),
  sizeBand: z.enum(["sm","md","lg","xl","ns"]),
  rowPosition: z.enum(["mid","left","right","both"]).nullable(),   // shared-wall shapes: which side walls are open
  wall: z.object({ down: WallMaterial.nullable(), up: WallMaterial.nullable() /* double storey only; null = same */, brickPainted: z.enum(["yes","no"]).nullable() }),
  gableFill: z.enum(["stucco","shingles","boards","strap"]).nullable(),
  windowType: ExtWindowType,                 // reuse the existing enum
  garageCars: z.union([z.literal(1), z.literal(2)]).nullable(),
  postKind: z.enum(["posts","columns"]).nullable(),
  parts: z.array(PartKey),                   // ticked on Build
  extras: z.array(ExtraKey),
  extraSizes: z.record(z.number()),          // metres or m² where asked
  sides: z.record(SideKey, z.object({
    paint: z.boolean(), shared: z.boolean(),   // shared = usually a party wall for this shape, after the end-of-row answer
    w: z.number(), h: z.number(), adjusted: z.boolean(),
    off: z.array(PartKey),                   // whole-house parts removed from this side
    add: z.array(PartKey),                   // parts added to this side only (a side gable, a back porch)
    material: WallMaterial.nullable(),       // this side's own wall material (downstairs); null = the house's
    materialUp: WallMaterial.nullable(),     // double storey: this side's own upstairs material
    confirmed: z.boolean(),                  // "Looks right" on the Each side step
    windows: z.number().int(), doors: z.number().int(),
    cond: z.enum(["good","weathered","peeling"]).nullable(),
    size: z.enum(["yes","adj","ns"]).nullable(),
    checked: z.boolean(),
  })),
}).optional()
```

`applyExteriorQuickLook` keeps writing the v1 fields the rest of the app reads (`elements`, `painting`, `substrates`, `targets`, `windowType`, `sides`, `sidesAnswered`, `condition` = the worst side, `extras`, `pergola`) **and** `v2`. `exteriorQuickLookFromState` reads `v2` when present. The sides seed (`starterExteriorNodes` → a new `exteriorV2Nodes`) builds from `v2` when present, else behaves exactly as today — older sessions and the `?entry=upload` door keep working.

The policy guardrails read `exterior.condition` (worst side) as today, so a peeling side still maps to the damage tier.

---

## 7. Screens

All screens: the refresh shell (header, rail, sticky footer with Back / Continue, two columns ≥ 901 px with the picture on the right; on a phone the picture card is sticky under the header, max 34 vh). Step rail for an outside job: **Your home · Painting · About it · Each side · Details · Your range**, and **Tighten** after the range. `stepsFor()` exterior becomes `start, place, home, paint, about, sides, gate`.

### 7.1 Your home (`home`)
"What kind of home is it?" — the nine shape cards, 2 per row on a phone, 3 on a laptop, each with its own small silhouette (`typeThumb` in the mockup). Tapping one draws the full house in the picture card. Then "About how big is it?" — five pills with the m²/bedroom hint. For a shape with shared walls, "Where is it in the row?" — *In the middle of the row (shares both sides)* / *End of the row — left side open* / *End of the row — right side open* / *Stands alone (all four sides)*; a unit, which usually shares one wall, offers *Shares the left wall* / *End — left side open* / *Stands alone*. The picture draws a dashed "next door" block on each shared side, and the Each side step starts those sides as not painting. Continue needs a shape and a size.

### 7.2 Painting (`paint`)
"Tap everything we're painting." Groups: On the house (the walls, gable ends), Roofline (fascias, gutters, downpipes, eaves), Windows & doors (windows, doors, garage door, window shutters), The verandah / Verandah or porch (verandah; then posts/columns, verandah ceiling, handrail once the verandah is ticked), Around the house (the nine extras). No material questions here. **Tapping a part on the picture ticks it too.** A brick-veneer hint: "tick the walls only if the brick is being painted". Continue needs at least one part or extra.

### 7.3 About it (`about`)
"Tell us about what you ticked." A card per ticked part that needs more: the walls (single storey: "What are they made of?", one material; double storey: "Two storeys are often two materials — Downstairs / Upstairs", with *Same as downstairs* first; painted or bare brick whenever brick is chosen anywhere; a stain note for vertical timber), the gable ends (fill), the windows (type — the drawing changes), the garage door (single/double), the posts (timber / brick or stucco columns / iron posts with lacework), the extras' rough sizes. Then **Colours** (the existing three cards) and **access** (the existing four chips, lift note). The picture's texture follows every answer.

### 7.4 Each side (`sides`)
"Check each side of the house." Four step tiles (Front · Right · Back · Left) with the picture turned to the current side and a compass in its header. Per side: the side's name and hint; **Not painting this side** (shared sides start that way, with a note, and can be added back); "Painting on this side" — the whole-house parts that land on this side as chips, each removable, plus **+ Add something on this side** which opens the rest of the parts list; "The walls on this side" (downstairs and upstairs rows on a double storey) with the full material list, tagged *Same as the house* or *Different from the rest*; **Looks right — next side**. The tile turns blue; the done card reads "All 4 sides confirmed. Sizes and counts come after your range." Continue needs every painted side confirmed. Changing a part or a material un-confirms that side until "Looks right" is tapped again. A side left "not painting" is not on the estimate (8 Sep ruling).

### 7.5 Details (`gate`) and the guide range
The existing gate with "Your job so far" (shape, size, parts, walls, sides, extras). The range screen is the refresh's, with the tier pill *Guide · within N%*, the band with the dashed "kerb-side" reference, **one row per side** (`w × h m · what was counted`) and one for "Around the house", the "Not in this number" line, and the doors in this order: **Tighten my price** (primary: "walk around the house side by side — about three minutes"), Book a site visit, Speak with us, Send us a message. The estimator card as today.

### 7.6 Tighten (`walk`)
Four step tiles (Front · Right · Back · Left) above a per-side card. The picture shows the current side, redrawn from the same parts, with a compass (F R B L) in its header that is also a jump. Per side:
- "Not painting this side" toggle (as set at 7.4, changeable here);
- the same "Painting on this side" and "The walls on this side" lists as 7.4, as confirmed there, still changeable;
- "Count them": windows and doors steppers (defaults from the width);
- "The size": `w m across × h m high`, tagged *Typical for a …* or *Your numbers*, with Looks right / Adjust it / Not sure; Adjust shows two steppers (0.5 m and 0.3 m steps);
- "How's the paint on this side?" (good / weathered / peeling);
- **Check this side** — turns the tile blue and moves to the next unchecked side. When every painted side is checked, a done card and the footer's **See my range**, which returns to the range screen now reading *Detailed*, with each side's row marked *checked* and the Tighten door replaced by *Change a side*.

### 7.7 After the detailed range
The existing sides editor and loop cards open with every side pre-filled and nothing re-asked (sizes confirmed show as confirmed; "not sure" sides open on the size; parts, materials, counts and condition as entered). The customer can still change anything.

### 7.8 "Both" jobs
Inside first (unchanged), then `home → paint → about → sides` (the Each side confirm) for the outside, then the one gate and the combined range; the stacked editor after the range is unchanged, with the outside half's rooms replaced by the tighten step's per-side cards.

## 8. The picture

One component `app/wizard/pictures/Elevation.tsx` replaces `OutsideHousePicture.tsx` for the outside steps: `elevation(side, { type, sizes, wall, gableFill, windowType, parts, sideState, build })` → SVG 400×240, scale = `min(280 ÷ w, 150 ÷ (h + rise + 0.4), 46)` px per metre so adjusting a side visibly changes the shape. Elements are `<g class="e e-<part>" data-e data-on>` with the mockup's colour layering (walls light cyan, gable cyan, roofline deep teal, openings teal; stain brown for vertical timber; greys when not painting). Materials are SVG patterns (boards, brick, render, stucco, sheet, Colorbond, vertical timber, shingles, strapping). Roof shapes: hip (trapezoid), gable (triangle + fill on gable sides, trapezoid on the long sides), parapet, skillion. The verandah, garage, chimney and extras draw as in the mockup. `aria-hidden`, decorative; `prefers-reduced-motion` respected (no animation beyond the refresh's). Port the drawing from the mockup's `elevation()`; it is deliberately plain JS.

Roof shapes: hip (trapezoid), full gable (gable-roof shapes, front/back), a centred cross gable on any side that has a gable added, parapet with cornice, dentils, pediment and chimney pots (terrace), skillion. The verandah draws on whichever side has one; iron-lace posts draw with brackets and a lace frieze.

Test hooks to add: `data-testid="pic-outside"` on the SVG with `data-side`; `.e[data-e][data-on]` per part; `ql-ext-type`, `ql-ext-type-<key>`, `ql-ext-size-<key>`, `ext-part-<key>`, `ext-extra-<key>`, `ext-walls-q`, `ext-gable-q`, `ext-windows-q`, `ql-ext-colour`, `ql-ext-sides`, `ql-ext-side-<key>`, `door-tighten`, `ext-walk-steps`, `ext-side-<key>`, `ext-side-np`, `ext-sidepart-<key>`, `ext-side-add`, `ext-side-mat`, `ext-win-n`, `ext-door-n`, `ext-size-yes|adj|ns`, `ext-dim-w|h`, `ext-cond-<v>`, `ext-check-side`, `ext-walk-done`, `ext-range`, `range-width` (number only, as the refresh requires).

---

## 9. Sessions

Each session: a feature branch, the failing spec first (anonymous customer), gates green, diff approval, Tom's phone check, ledger row. Gates: `npm run build`, `npx tsc --noEmit`, `npx eslint --max-warnings 4 .`, `npm test`, the named Playwright specs with `E2E_BASE_URL` set (one worktree runs e2e at a time; if the lock is held, wait once and report).

| # | Ships | Gate specs | Tom's check |
|---|---|---|---|
| S0 | Pack committed (`docs/briefs/claude-code-brief-exterior-wizard-v2.md`, the mockup under `design/reference/`), ledger `docs/briefs/exterior-v2-progress.md` started, "before" screenshots of the current outside path into `ui-refresh-shots/exterior-before/` (kept out of git, same worktree), the current failing/passing state of the five exterior specs recorded. Stop. | — | The mockup on his phone: all three "Try" presets, one full walk-around. "Mockup approved" or changes. |
| S1 | **Data and model.** `exterior_typicals` migration (table + RLS + grants + seed script + `_prod_migrations` row; the SQL goes in the PR body for Tom, never run by the session) · `v2` state schema · `lib/wizard/exterior-model.ts` (pure: `v2` + typicals + rate items → per-side area nodes, extras nodes, deferrals; `exteriorV2Nodes`) · `applyExteriorQuickLook`/`fromState` round-trip · unit tests incl. a golden bungalow (12 × 16 × 3.0, gable 2.4, 4 sides, 9 windows, 2 doors, verandah) whose quantities are asserted line by line · `envelope.test.ts` for confirmed-sides narrowing. No screens yet. | unit only | Read the golden test's quantities and say they match how he measures (⚑ 7, ⚑ 8). |
| S2 | **Your home + the picture.** `Elevation.tsx`, `typeThumb`, the `home` step, `stepsFor` change behind a flag `exteriorV2` (default ON on the test project, OFF in production until S6). | `exterior-v2-home.spec.ts` (new): every shape draws, size scales the caption, shared-side note, resume | Pick each shape on his phone; "does it look like that house?" |
| S3 | **Painting + About it.** Parts and extras with picture taps; then the material, gable, window, garage, posts and extras-size cards, colours and access; the picture's texture follows. | `exterior-v2-paint.spec.ts`, `exterior-v2-about.spec.ts` (new) | Tick a bungalow fully; change the walls to render and watch the picture. |
| S4 | **Each side + gate + the guide range.** The per-side confirm (parts, add-from-the-full-list, per-side material, not painting), "Your job so far", the range rows per side, the Tighten door first, Guide from the real envelope on the typical-size tree. | `exterior-v2-sides.spec.ts`, `exterior-v2-range.spec.ts` (new); `exterior-path.spec.ts` updated | A whole quick path on his phone, adding a gable on the right side of a bungalow; the guide range reads right for a bungalow and a townhouse. |
| S5 | **Tighten + the detailed range + both.** The per-side card reusing S4's lists plus counts, size and condition per side (⚑ 1), done card, Detailed from the real envelope, the existing sides editor reading v2 (nothing re-asked), restatement and assumed list rewritten, the "both" outside half, staff tree/deferrals checked on PC Command. | `exterior-v2-tighten.spec.ts` (new); `sides-editor.spec.ts`, `both-stacked.spec.ts` updated; `outside-commercial.spec.ts` unchanged and green | Tighten a bungalow with a gable added on the right side; open the estimate as staff and see that side's gable line. |
| S6 | **Finish.** Old `outside`/`sides` steps removed behind the flag (kept for one release for resume), `exterior-quick-look.spec.ts` and `exterior-batch-15sep.spec.ts` rewritten to v2 (list every retired assertion in the PR with the ruling that retires it), help files, "after" screenshots, `docs/ARCHITECTURE.md` paragraph, ledger closed, parking lot entries. Flag `exteriorV2` ON in production is Tom's switch. | all exterior specs; full customer-journey suite | Final phone check, all three presets + a unit. |

---

## 10. Acceptance criteria

**Accuracy**
1. The golden bungalow (S1) prices every line in §5.2 at the live card's rates with the stated quantities; changing the front width from 12 m to 10 m changes the front wall, fascia, gutter and eaves quantities and nothing else.
2. A single storey has one wall line per side; a double storey with different downstairs and upstairs materials has two, each `w × h ÷ 2`; "same as downstairs" has one. A side with its own material prices that material on that side only.
3. A townhouse starts with left and right "not painting"; those sides are absent from the tree unless added back. An end of terrace with "left side open" starts with the left side painting and the right side off; "stands alone" starts with all four.
4. Vertical timber with "stained" prices at `Cutek`; with "painted" at `Weatherboards`. Bare brick prices at `Brick (Unpainted)`.
5. At the gate the tier reads Guide and the tree carries the shape, size band, parts, materials and default counts; with all painted sides checked ("Looks right" or adjusted) and condition answered on each, `envelopeFor` reports `bandPct` ≤ the mid band and the tier reads Detailed; with one side "Not sure" it is wider.
5a. A gable added on the right side of a bungalow, a porch added at the back, and render chosen for one side — on the Each side step or on Tighten — each produce exactly one extra or changed line on that side's node and nothing elsewhere.
5b. The guide range at the gate already reflects every per-side confirm (a side marked not painting is absent; a side's own material prices on that side).
6. Nothing in `lib/pricing/**` changes (`git diff --stat` on the PRs shows no file there).
7. Shingles, "something else", aluminium windows, winder/not-sure windows and "not sure" sizes each raise a deferral the estimator sees; none of them prices silently at $0 or at a guessed rate without a flag.

**Experience**
8. No dollar figure appears before the gate on a home job (`range-width` and `.sc-num` absent on `home`, `paint`, `about`, `sides`). The material questions never appear for a part that is not ticked; a single storey is never offered a second material.
8a. Each side cannot continue until every painted side is confirmed; changing a part or material on a confirmed side un-confirms it.
9. Every part chip lights its part on the picture within one frame; tapping the picture toggles the same chip.
10. On a phone (390 px) every screen has no horizontal overflow, the picture card stays under the header while scrolling, and every control is ≥ 44 px tall.
11. The range screen's first door is Tighten my price until every painted side is checked, then Change a side; the tighten step cannot return to the range as Detailed until every painted side is checked; "Check this side" is disabled until the size question is answered; the done card appears when the last side is checked.
12. The after-range sides editor opens with nothing re-asked for a v2 session; a v1 session (saved before S6) resumes exactly as today.
13. `outside-commercial.spec.ts` passes unchanged. `both-stacked.spec.ts` passes with the outside half on the new screens.
14. Help files updated for customer and staff; `npm run help:index -- --check` passes; the estimator help names every new deferral.

**Process**
15. Each session's PR lists: retired assertions and the ruling behind each; new test ids; parking-lot entries; the ledger row.
16. No SQL executed by the session; the migration and seed are in the PR body; `_prod_migrations` is read back before S2 depends on the table.

---

## 11. Out of scope (parking lot)

- The rate card questions (⚑ 6 weathered vs poor; a shingles row; `Window Shutters` extras vs `Wood Shutters`).
- Photo-read elevations (`lib/extract/exterior.ts`) — unchanged; a later brief can pre-fill the walk-around from a photo read.
- Roof painting (`Roof` row exists; no chip yet — ⚑ 16).
- Staff mode's older outside page.
- The trade lane.
- The "Imported · Custom surface" chip (still open from the refresh).

---

## 12. ⚑ Decisions for Tom

Each has a default so the build never waits. Write a ruling on the line to change it; Claude Code logs rulings in the ledger.

| ⚑ | Decision | Default | Ruling |
|---|---|---|---|
| 0 | **Where the walk-around sits.** Your 12 Oct review put it after the guide range as the tighten step (the same shape as every estimate). Your first note that day had the per-side ticks before the gate. The screen is identical either side of the gate; moving it is a `stepsFor()` change. | After the range (tighten). | ______ |
| 1 | **Condition per side** on the tighten step, instead of once for the whole house as the first tighten question today. | Per side. | ______ |
| 2 | **The typicals table** (§5.1): front, side, height, gable rise per type. | My numbers, flagged `source: proposed` in the seed until replaced. | ______ |
| 3 | **The nine home shapes and their names.** Add, remove or rename (e.g. "Edwardian / Federation" as its own card? a two-storey terrace?). | As listed. |______ |
| 4 | **Shingles** have no rate row. | Deferral — estimator prices; the range says "not in this number". | ______ (or: add a row at ___ m²/h) |
| 5 | **Brick home default:** walls start "not painted"; ticking the walls asks "painted before?" | As described. | ______ |
| 6 | **Weathered ×1.8 vs peeling ×1.35** on the card — weathered prices above peeling. Outside this build. | Unchanged; raised in the parking lot. | ______ |
| 7 | **Gable sides:** fascias = the rake (barge boards); gutters = 0 on the gable side. | As described. | ______ |
| 8 | **Verandah rules:** posts = `max(2, round(0.8w ÷ 2.6) + 1)`; ceiling = `0.8w × 2.4 m`; handrail = `0.8w`; iron lacework has no rate row — priced at `Posts` with a lacework deferral. | As described; all editable after the range. | ______ |
| 9 | **Shutters** price at `Wood Shutters` (hours per item, 3.25 h at 2 coats) rather than the `Window Shutters` $240 extras row. | `Wood Shutters`. | ______ |
| 10 | **Shared sides** pre-set to "not painting" for townhouse (left, right), unit (left), terrace (left, right), unless the "Where is it in the row?" answer opens a side (end of the row) or both (stands alone). | As listed. | ______ |
| 11 | **Downpipes:** 1 per side, 2 if the side is over 10 m. | As described. | ______ |
| 12 | **Default window counts** by width (`round(w ÷ 4.5)` front/back, `round(w ÷ 5)` sides, × storeys). | As described. | ______ |
| 13 | **"Not sure" size** keeps the typical, stays flagged, and counts as unconfirmed for the band. | As described. | ______ |
| 14 | **Tighten door** is first on the guide range; once every side is checked it reads "Change a side" and Book a site visit becomes the primary door. | As described. | ______ |
| 15 | **No deduction for openings** from wall area (house convention today). | Keep. | ______ |
| 16 | **Roof painting** chip. | Not now. | ______ |
| 17 | **Production switch:** `exteriorV2` flag ON in production after S6. | Tom flips it. | ______ |
| 18 | **Double storey heights:** downstairs and upstairs are equal halves of the wall height; a single storey never gets a second material (so a weatherboard home on a brick base is one material — the customer picks the bigger one, and the estimator corrects it on the visit). | As described. | ______ |

---

## 13. Kickoff

Paste into a new Claude Code chat in its own worktree:

> Read `docs/briefs/claude-code-brief-exterior-wizard-v2.md` and the mockup it names. Run S0 from §9: commit the pack, start the ledger, take the "before" screenshots, record the state of the five exterior specs, and stop. Reply WAITING FOR GO.

Then `Go: S1` … `Go: S6`, one session per chat, each ending with the ledger row and the phone-check line.
