# Estimator journey v2 · Phase 3 — coats and preparation, derived

**Built:** 9 September 2026 · branch `feat/paint-systems-derivation` · **no migration**
**Brief:** `docs/briefs/estimator-journey-v2-plan.md` §4.2, §9.3 · prototype
`design/reference/estimator-journey-v2.html` (screen 8, "How we'll paint each surface")
**Scope ruling (Tom, 9 Sep):** phase 3 first, ahead of the phase-2 flow. The ⚑ decisions
ship as the plan's own §10 suggestions, each recorded here and in the code.

---

## 1. What was wrong

The wizard asked the customer to choose coats for the whole job, on a card that read
**"1 COAT / 2 COATS / 3 COATS"**, under the line *"This sets how many coats we allow for."*
`coatsFor(tier, isDarkToLight)` then stamped that single number onto every surface in the
tree — walls, ceilings, skirtings and doors alike.

Coats differ by surface. New-colour walls take two; a white-on-white ceiling usually takes
one; enamel trims take two whatever the colour, plus preparation. A homeowner cannot judge
that and should never have been asked to. Plan §2.2 calls it the single biggest accuracy gap.

## 2. What ships

`lib/pricing/systems.ts` — a pure lookup, `deriveSystem(group, answers, table)`:

| | Same colours | New colours | Much lighter / bold |
|---|---|---|---|
| **Walls** | 1 | 2 | 3 (undercoat + 2) |
| **Ceilings & cornices** | 1 | 1 · **2 when marked** ⚑3 | 2 |
| **Skirtings & architraves** | 2 · **1 when condition is good** ⚑4 | 3 (undercoat + 2) | 3 |
| **Doors** | 2 | 3 | 3 |
| **Windows** | 2 | 2 | 2 |

Plus, on top: a **bonding primer** (+1 coat) when the existing trims are an oil-based
gloss ⚑5; the **condition band** carrying prep hours per unit; and a per-surface
dark-to-light lift.

Each cell also carries the **sentence the customer reads** and, where relevant, the
**crew note the painter reads** — the paint-systems screen in phase 4 renders
`systemsForSurfaces()` straight out of this module.

### The plan's own acceptance criteria (§9.3)

- *2-coat and 3-coat totals unchanged* — the derivation is a new layer in FRONT of the
  engine. `coatMultiplier` and the card's 1/2/3-coat columns are untouched, asserted in
  `systems.test.ts`.
- *Single coat only via same-colour* — enforced per SURFACE, not per job, and enforced
  **over Settings**: a "1" typed into any new/bold cell is refused by the Settings screen
  and overridden again at derivation time. The one legitimate single coat on a
  colour-change job is a ceiling staying white, which is not a colour change.
- *A same-colour and a new-colour job differ only in walls and trims* — asserted
  directly: `moved === ["walls", "trims", "doors"]`, doors being the trims row by
  another name. Ceilings and windows do not move.

## 3. ⚑ Rulings applied

| ⚑ | Ruling | Where it lives |
|---|---|---|
| 2 | The whole table is Settings, not constants | `paint_systems` row · Settings → Estimates → Paint systems |
| 3 | Ceilings one coat white-on-white; "they're marked" is the two-coat tap | `ceilingsMarkedCoats` |
| 4 | Same-colour trims **two** coats; one only when condition is good | `trims.same` + `trimsGoodConditionCoats` |
| 5 | Ask the gloss question; "not sure" is the default | `glossBondingPrimer` + `review` |

> **⚑4 contradicts the plan's own §4.2 table**, which says "Sand + 1 coat enamel" for
> same-colour trims. Decision ⚑4 says two, one only when condition is good. The later,
> explicit ruling is what ships. To follow the table instead, set `trims → Same colours →
> Coats` to 1 in Settings — no deploy.

## 4. What it moves in money

`npx tsx scripts/paint-systems-impact.ts` — reads only, prices a 3-bed single-storey
interior both ways on the golden rate card:

| Colour intent | Condition | Was | Now | Change |
|---|---|---|---|---|
| Same colours again | good | $4,172 | $4,875 | **+$703 (+16.9%)** |
| Same colours again | some wear / needs work | $4,172 | $5,210 | **+$1,038 (+24.9%)** |
| New colours | any | $7,187 | $7,046 | −$141 (−2.0%) |
| Much lighter / bold | any | $7,187 | $9,023 | **+$1,836 (+25.6%)** |

The same-colour rise is ⚑4 doing its job: a one-coat enamel trim job was being quoted at
a price that could not be delivered. The new-colour fall is ⚑3's ceiling, partly offset by
the trims. **These are real movements and they want a look before "fix online" is turned
on** — the calibration gate (plan §8) is unchanged by this work.

## 5. Boundaries — what phase 3 deliberately does NOT do

- **No exterior.** Every exterior substrate returns `null` from `groupForSubstrate` and
  keeps the whole-job coat count. Plan §4.4: the per-elevation allowances spec (§8) does
  not exist, and deriving exterior systems without it would be inventing numbers.
- **Prep hours are zero on all three bands.** Prep already reaches the tree from
  `defect_prep_rates` (the photo pipeline) and the manual stepper. A non-zero default here
  would silently reprice every job on day one, and would double-count against those two.
  The band has a home; the hours wait for worked hours from the proving window (⚑2).
  They are also not yet multiplied into a line — that needs the priced quantity, which
  lives in `lib/pricing/estimate.ts`, and belongs with phase 5's allowance wiring.
- **No paint-systems SCREEN.** That is phase 4. `systemsForSurfaces()` is its body and is
  built and tested; what is missing is the customer-facing screen that renders it and
  writes back the two ceiling answers and the gloss answer.
- **The gloss question is not yet asked unconditionally.** It reuses the existing
  `paint.trimsOilBased` field — one question, one field — which today is only asked as a
  follow-up to "water-based only". Until phase 4's screen asks it directly, most jobs read
  `null` → "not sure" → priced as no, with `review` set for the estimator. That is ⚑5's
  intended default, reached by the long way round.

## 6. Verification

- **1,826 unit tests green** (190 files), including 29 new in `lib/pricing/systems.test.ts`.
- **Production build green** (the C1 runner builds before it tests).
- **2 e2e green on the C1 test stack**, `e2e/paint-systems.spec.ts` — the Settings table
  renders with the ⚑ defaults, a non-covering coat blocks the save, the save works, and
  the wizard no longer shows a coat chip anywhere.
- **Two existing tests were rewritten, not deleted** — `merge.test.ts` ("freshen up = one
  coat on everything") and `propose.test.ts` ("re-coats every row to 3"). Both asserted
  the behaviour this change removes; they now assert the per-group rule and carry a
  comment saying what changed and why.

## 7. Next

Phase 4 — the rooms and paint-systems screens — is the natural follow-on: the derivation
is built, and the screen is the surface that lets the customer correct it, which is what
makes the whole approach honest. Phase 2 (the quick look and the guide range) remains
gated behind the §9.1 prerequisites.
