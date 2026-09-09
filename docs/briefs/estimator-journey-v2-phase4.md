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
