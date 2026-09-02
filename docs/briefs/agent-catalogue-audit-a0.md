# Session A0 — catalogue audit for the assistant's tightening gaps (R5 / ⚑ D19)

**Date:** 2 Sep 2026 · **Brief:** Addendum A §4 "A0 — Rulings + catalogue check" · **Source of truth:** active rate card v7 (64 items, read live), `defect_prep_rates` v3, `lib/extract/scope.ts`, `lib/wizard/merge.ts`, `lib/wizard/rooms-loop.ts`, `lib/wizard/sides.ts`

The addendum's tightening-gap list (§3.1) needs three things priced as attributes the assistant can assume and later confirm: **door style**, **window type**, **cupboard interiors**. Plus the **minor-defect prep rate** for "a few minor cracks". This is what exists today and what is missing.

---

## 1. Door style — flat vs panel: ✅ already a priced attribute

| Rate item (Interior Doors, per item, 2 coats) | Hours | ≈ $ at $95/hr |
|---|---|---|
| Flat Door (1 Side) | 0.53 | 50 |
| Flat Door and Frame (1 Side) | 1.07 | 102 |
| 4-6 Panel Door (1 Side) | 0.80 | 76 |
| 4-6 Panel Door and Frame (1 Side) | 1.60 | 152 |
| Architrave (1 Side) | 0.53 | 50 |

- `doorCodeFor(style, scope)` in `lib/extract/scope.ts` already resolves flat/panel × door/frame to a code, and `doorStyleOfCode` reads it back.
- The wizard's "mostly" answer (`details.doorStyle` = flat / panel / unsure) drives it in `lib/wizard/merge.ts`; **unsure prices at the flat rate**, tagged `ai_assumed` with `assumedFields: ["style"]` and an amber "door style to confirm" trace. This is exactly the addendum's assumption-chip behaviour, already in the data model.
- **Swing per door (frame scope):** panel − flat = 0.53 h ≈ **$50/door at 2 coats**. On a 3-bed with ~7 door sides that is ≈ $350, which is what `price_scope` will report as this chip's $ impact.

**Gap: none for rates. D19 needs no door decision.** A1 just needs the engine to expose the swing (price the tree with the alternative code and diff).

---

## 2. Window type: ✅ rates exist · ❌ no picture-chip UI yet

| Rate item (Interior Windows, per item, 2 coats) | Hours | ≈ $ |
|---|---|---|
| Fixed / Picture / Window Reveal | 1.34 | 127 |
| Awning / Casement Window | 1.60 | 152 |
| Double Hung Sash | 2.14 | 201 |
| Colonial / Bay Window | 3.21 | 305 |
| Window Reveal (M2) | 1.00 /m² | 95 /m² |

Exterior has the same four families at $105/hr (Fixed 164 · Awning 197 · Sash 263 · Colonial 393).

- Unsure prices at **Awning / Casement** (`merge.ts`), tagged `ai_assumed` `["style"]`, amber "window style to confirm". Wizard answers: casement / sash / colonial / winder (winder rides the awning rate — `windowStyleToSchema`).
- **Size S/M/L** is a Settings-tunable multiplier 0.8 / 1.0 / 1.2 on the window rate (`windowSizeMultiplier`, `applyWindowSize` in `sides.ts`); M/absent = no change. So "size M [assumed; chip]" in the golden fixture is already representable.
- **Swing per window:** widest alternative − assumed = Colonial − Awning = 1.61 h ≈ **$153/window**; cheapest alternative = Fixed − Awning = −0.26 h ≈ −$25. `price_scope` should report the max absolute swing (≈ $153 × window count) so this chip ranks honestly.

**Gap: UI only.** The wizard asks window style as text options (`WizardApp.tsx`); the addendum wants picture chips reusing the exterior wall-mix chip pattern. The wall-mix chips live in the customer sides loop (`lib/wizard/sides.ts` `wallSumPct` / geometry chips, rendered in `WizardApp.tsx` and `app/estimate/scope/SidesEditor.tsx`). That is A2 work, not a rate decision. **D19 needs no window-rate decision** unless Tom wants a fifth type.

---

## 3. Cupboard interiors: ❌ missing — the only real catalogue gap

What exists is cupboard **fronts** only (migration `20260920000000_cabinetry_rates.sql`, rebuild addendum R3):

| Rate item (Interior · Cabinetry, per item, 2 coats) | Hours | ≈ $ | Asked in |
|---|---|---|---|
| Kitchen Cupboard Front | 1.00 | 100 | kitchen — default 14 fronts |
| Robe Door | 1.65 | 156 | bedroom — default 2 |
| Vanity Door | 1.12 | 106 | bathroom — default 2 |

`CUPBOARD_BY_ROOM_TYPE` in `lib/wizard/rooms-loop.ts` renders the per-room cupboard question **only when the code exists on the active card** (data-driven), so adding interior rows makes the question appear with no code change beyond the map entry.

There is **no "inside the cupboards" item** at all. The assistant's chip "cupboard interiors not included" therefore has nothing to price when the answer is yes.

### Proposed rate rows (⚑ D19 — Tom sets the numbers)

Derived the same way the cabinetry migration derived fronts: hours per item at the card's charge-out, indicative 2-coat dollars. Interiors are brushed/rolled, not sprayed, and are shelf-and-carcass work with awkward access; I have anchored them at roughly half the matching front, per carcass rather than per door.

| Proposed code | Sub-category | Unit | 1 coat | 2 coats | 3 coats | ≈ 2-coat $ | Asked in | Default count |
|---|---|---|---|---|---|---|---|---|
| Kitchen Cupboard Interior | Cabinetry | Hours Per Item (per carcass) | 0.30 | 0.50 | 0.70 | 50 | kitchen | 8 carcasses |
| Robe Interior | Cabinetry | Hours Per Item (per robe) | 0.90 | 1.50 | 2.10 | 143 | bedroom | 1 per bedroom |
| Vanity Interior | Cabinetry | Hours Per Item (per vanity) | 0.36 | 0.60 | 0.84 | 57 | bathroom | 1 |
| Linen / Broom Cupboard Interior | Cabinetry | Hours Per Item (per cupboard) | 0.60 | 1.00 | 1.40 | 95 | hallway / laundry | 1 |

**Questions for Tom with the numbers:**
1. Per **carcass** (as proposed) or per **front** to match how fronts are counted? Per carcass is easier for a customer to count ("how many cupboards?").
2. Do interiors include **shelves** by default, or is that a coat/extra?
3. Does "colour match throughout" ever extend inside cupboards, or are interiors always white? (Affects whether the colour-coordination allowance touches these lines.)

Once Tom sets the numbers, this ships as one idempotent migration in the `20260920` pattern (template row = the matching front, skip codes already on the card) plus four entries in `CUPBOARD_BY_ROOM_TYPE`.

**Swing for the chip (from the proposal):** a 3-bed 1-bath with kitchen ≈ 8×$50 + 3×$143 + $57 + $95 ≈ **$980** — a large swing, so this chip will rank near the top of the tightening order, which matches Tom's example.

---

## 4. Minor-defect prep rate ("a few minor cracks to the kitchen"): ✅ exists

`defect_prep_rates` v3 (16 defect types). The one the golden fixture needs:

| defect_type | unit | sev1 h | sev2 h | sev3 h |
|---|---|---|---|---|
| plaster_cracks | lin_m | 0.12 | 0.22 | 0.40 |
| holes_dents | each | 0.15 | 0.25 | 0.45 |
| scraping_filling | m2 | 0.15 | 0.25 | 0.40 |

"Minor cracks" = `plaster_cracks` at **severity 1**, needs a lin-m quantity. For an unseen "a few minor cracks" the assistant must assume a quantity — propose **3 lin m per room mentioned** (≈ 0.36 h ≈ $34 at $95/hr) as the amber placeholder, with photos confirming. ⚑ Tom to confirm that placeholder in D22's answer (it is the number that shows until a photo is seen).

Note the three versions in the table (v1–v3): only v3 carries the capture add-ons (bogging, stripping, scraping, caulking). The assistant must read the current version the same way `lib/extract` does, not "any row".

---

## 5. Also confirmed for A1/A2

- **Accuracy bands** are Settings-tunable in `lib/wizard/policy.ts`: `rangeBandPct` (≥90 ±4 / 70–89 ±8 / <70 ±15) and `rangeFromTotal` (rounded outward to whole tens). Range width must come from these only — no new band logic.
- **Ceilings** are not in the fixture paragraph. `merge.ts` only prices what is ticked, so "not stated → not included, chip" is the natural behaviour; A1's test guards it.
- **Colour match** → colour-coordination allowance state already exists on the estimate (allowances ride prepHr; see memory `settings-and-allowances`). A state, not a row — as the addendum says.

---

## 6. What does not exist (blocks A1 onward, not A0)

None of the assistant module is in the repo: no `agent_conversations`, `price_scope`, `propose_diff`, `gapsFor`, question graph, inbox or attention queue. Those are all defined by the **parent brief**, which is not in `docs/briefs/`. A1 cannot start until it is.
