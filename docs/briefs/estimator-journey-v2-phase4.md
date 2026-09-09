# Estimator journey v2 · Phase 4 — the paint-systems card

**Built:** 9 September 2026 · branch `feat/paint-systems-screen` (stacked on
`feat/paint-systems-derivation`) · **no migration**
**Brief:** `docs/briefs/estimator-journey-v2-plan.md` §3, §4.2 · prototype
`design/reference/estimator-journey-v2.html` screen 8

---

## 1. Why this had to follow phase 3 immediately

Phase 3 stopped asking the customer to pick coats and derived them per surface instead. On
its own that is not obviously an improvement: it replaces a question they could not answer
with an assumption they could not see. Plan §2.2 is blunt that this is *"the bit most quotes
hide"*.

This card is the other half of the bargain. It shows what was derived, in the painter's own
words, and gives one tap per line to correct it.

## 2. What ships

**`lib/wizard/systems-view.ts`** — pure, and the whole surface:

| | |
|---|---|
| `systemAnswersFromState` | The **one** reader of the customer's answers. Now shared by `merge.ts` (stamps the coats), the view (explains them) and the route action (re-derives them). |
| `paintSystemsView` | One line per group: sentence, coats, correction chips, `review`, and *why* the coats differ from the plain table cell. |
| `applySystemPatch` | The corrected answers, mapped back onto the stored wizard state. |
| `applyPaintSystems` | The re-derived tree. |

**The card** sits in the customer scope editor above the room cards, and renders exactly
what the module returns. Corrections available: walls colour intent (that's right / going
much lighter / same colour actually), the two ceiling taps ⚑3, and the gloss question ⚑5
on trims and doors.

**The route** gains `set_paint_system`. The customer posts a **field and a value — never
coats**; the server re-derives from Tom's Settings table. Same boundary as everywhere else
on this route: answers in, never geometry or money.

## 3. Three rules, each with a test

1. **Groups come from the TREE, not the wizard's tick list.** By the time the customer
   reaches the editor they have added and removed surfaces. A ceilings line on a job whose
   ceilings were removed is a lie — and the tick list would still say yes.
2. **Interior only.** An exterior-only job gets **no card at all** rather than a card of
   numbers nobody has validated (plan §4.4).
3. **A correction re-derives the WHOLE tree.** Colour intent is job-wide: "same colour
   actually" on the walls has to move the trims too, or the estimate holds two answers to
   one question. The e2e asserts exactly this.

## 4. A bug the card caught in itself

The first run on the real screen rendered:

> **Ceilings and cornices · 2 coats**
> White again. One fresh coat of flat ceiling white over a sound surface.

⚑3's "they're marked" tap lifted the coats but left the cell's sentence, which had been
written for the one-coat system. A card whose entire job is to show the derivation honestly
was contradicting itself in its second line.

Fixed (`MARKED_CEILINGS_SENTENCE`), and guarded two ways: a specific test, and a general one
that sweeps every reachable combination and asserts no line promises one coat while deriving
more. That general test immediately found a second case — same-colour trims in good
condition with an oil gloss: *"one coat of water-based enamel. A bonding primer first."*
That one is **not** a contradiction (the sentence counts topcoats, the heading counts labour
coats and says "one an undercoat"), so the test is scoped to lines with no undercoat. The
distinction is written into the test.

## 5. Traps worth keeping

- Nesting `z.discriminatedUnion("field", …)` inside `actionSchema` with `.and()` **collapses
  the outer `action` discriminator** and every `act.` narrowing in the route breaks. The
  posted shape is flat; `systemPatchFrom` pairs field to value and returns null → 400 rather
  than coercing. A customer who taps a chip and sees nothing move has been lied to.
- The crew note is **replaced, not appended** — this runs on every correction, and appending
  grew `check the trims | check the trims | …` on a second tap. `stripSystemNotes` removes
  only the notes this module writes, so notes from elsewhere survive.
- "That's right" on the ceilings clears **both** ceiling flags, or the line stays at two
  coats and the card argues with itself.
- Moving colour intent away from bold clears `darkToLightSurfaces` — that list belongs to the
  old per-surface question and would otherwise lift surfaces the customer just said are
  staying the same.
- `paintSystems` rides **every** response, not only a `set_paint_system` one: removing the
  last ceiling must remove the ceilings line, and that arrives as a `toggle_surface`.

## 6. Verification

- **1,848 unit tests green** (191 files) — 20 new in `systems-view.test.ts`, 2 more in
  `systems.test.ts` for the contradiction.
- **Production build green**; **e2e green on the C1 test stack**
  (`e2e/customer-journey/paint-systems-card.spec.ts`) driving a real customer estimate from
  the wizard through to the card: the lines render, "same colour actually" drops the walls to
  one coat **and moves the trims with them**, the range changes, ⚑3 lifts the ceilings and
  explains why, and ⚑5 adds the primer and clears the review note.

## 7. Still not done in phase 4

§9.4 also lists **flagged spots with photos as repair lines** (§4.3 + ⚑6: crack and nail hole
auto-price from `defect_prep_rates`, the rest to estimator review) and the **per-room extras**
(§4.5: feature walls, wallpaper to strip, "something else in here"). Neither is built. The
room card, its surface tiles, counts, walls-share and allowances already existed before this
phase; per-room condition and spots do not.

---

# Addendum — per-surface condition flags (Tom, 9 September)

> *"What if the customer wants to update the number of coats on doors to 3 coats cause they
> are all stained, but the rest are 2? Or if the customer wants to update the ceilings to 1
> coat, but everything else 2?"*

## The two cases are not the same

**Ceilings at 1 while everything else is 2 already worked.** Ceilings derive independently of
the walls, so white-on-white is one coat on a job whose walls take two — that is ⚑3, shipped
in phase 3.

**Doors at 3 because they are stained could not be said at all.** Every correction on the card
was either job-wide (colour intent) or a single yes/no (marked ceilings, gloss trims). Nothing
let a customer say that one surface GROUP needs more work than the rest — which is one of the
commonest things they actually know about their own house. A real gap.

## Why the fix is not a coat picker

The obvious answer — a number box per group — is wrong for three reasons, and they are the
same three that put the derivation in the engine in the first place:

1. **Plan §4.2: the customer never picks coats.** They describe what is there; we work out
   what it takes. A flag is a description. A number is us handing the judgement back.
2. **A picked "1" over a colour change is a warranty claim, not a saving** (§7.6). A flag
   cannot reach past the coverage guard. A number would try to, and someone would eventually
   let it.
3. **A number tells the painter nothing.** "They're stained" tells them to stain-block, rides
   to the work order as a crew note, and tells the estimator whether the price is right.

## What ships

`SurfaceFlagRule` — a Settings-editable catalogue. Each flag names the groups it applies to
and what it does: a floor on the coats, a ceiling on them, whether the extra coat is a primer,
the sentence the customer reads and the note the painter gets.

| Flag | Groups | Effect |
|---|---|---|
| They're stained | walls, ceilings, trims, doors | ≥ 3 coats, blocking primer |
| Bare or raw timber | trims, doors, windows | ≥ 3 coats, timber primer |
| New plaster | walls, ceilings | ≥ 3 coats, sealer |
| They're marked | ceilings | ⚑3's number (`ceilingsMarkedCoats`) |
| They're sound — one coat is plenty | ceilings, walls, trims | ≤ 1 coat, **and flags the line for review** |

**⚑3 became one of these rather than staying a branch of its own**, so the ceilings card and
the doors card cannot drift apart — one mechanism, one place to change it. `ceilingsMarked` is
still the stored field the ceilings chip writes; it is folded into the flag set at derivation.

The customer's answers live at `condition.surfaceFlags` — `{ doors: ["stained"] }`. Keys are
**not** validated against the catalogue in the schema: Tom can add or rename a flag in
Settings without a migration, and a key that no longer exists simply stops applying rather
than 400-ing somebody on a stale page.

## A bug this found

`⚑5`'s gloss note **overwrote** the crew note instead of appending, so a stained door on a job
whose trims might be oil gloss arrived at the painter told to bond-prime and *not* told to
stain-block. Crew notes now accumulate (`addNote`), de-duplicated so a re-derivation cannot
grow them. Two tests hold it.

## Verification

1,865 unit tests green. Both of Tom's cases are asserted by name, in the engine and again on
the real screen: stained doors go to three coats while the walls stay at two and the ceilings
stay at one; sound ceilings drop to one while the walls stay at two and the line is flagged
for review. The e2e also asserts there is **no number input anywhere on the card** — the point
of the design, and the thing a future change would quietly break.

---

# Phase 5a — site and access

§4.4 and the first third of §9.5. **No migration, and no multipliers.**

Interior access was never asked (§2.4). It is now: rooms cleared · floors · stairwell or void ·
parking · lift booking (units only) · pets.

**The spec this screen is supposed to be "verbatim" is not in the repository.** Plan §8 says the
allowances spec "must land first" and §9.1 gates the phase on it. Rather than invent four
multipliers, each answer names a modifier code and follows the pattern already used for
weathered exteriors and occupied homes: **use Tom's modifier if he has seeded it, raise an amber
note naming the code if he has not.** The note says exactly where to seed it.

So the screen is live and honest today, and starts pricing the moment Tom sets a multiplier in
Settings → Pricing → Modifiers — no deploy, no code change.

| Answer | Modifier code | Group |
|---|---|---|
| Mostly cleared | `ACC-PART-CLEARED` | Staging |
| Furniture stays | `ACC-FURNITURE-STAYS` | Staging |
| Hard or mixed floors | `ACC-HARD-FLOORS` | Access |
| Stairwell or void | `ACC-STAIRWELL` | Access |
| Tricky parking | `ACC-PARKING` | Access |
| Lift booking | `ACC-LIFT-BOOKING` | Access |

Cleared rooms, carpet, a driveway and "no pets" cost nothing and raise nothing.

**⚑ For Tom:** seed those six modifiers with your own multipliers and the screen starts pricing.
Until then every costly answer reaches the estimator as an amber note, so nothing is lost — but
nothing is charged either.

**Still open in phase 5:** the whole-job extras sheet (§4.5 — mould treatment, ceiling roses,
stain or varnish, help choosing colours, plus a description box) and the per-room extras
(feature walls priced as their own colour, wallpaper to strip). The finish line's
policy-driven options largely exist already (the ladder, "Finalise my price", "Book a site
visit", "Request a call back").
