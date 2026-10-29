# Build plan — Exterior wizard on mobile v5

**What this is:** the outside (exterior) path built to the v5 mobile pattern. Follows `build-plan-wizard-mobile-v5.md` S7; starts as its own branch `feat/exterior-mobile-v5`.
**Governing docs, in order of authority:**
1. `claude-code-brief-exterior-wizard-v2.md` (12 Oct) — the questions, their order, the model, the typicals, the per-side rulings. **Nothing here changes a question or the pricing tree.**
2. `claude-code-brief-wizard-mobile-v5.md` + `wizard-mobile-v5-prototype.html` — the mobile shell, strip/roller, Contact, gate, copy rules.
2a. **`wizard-exterior-mobile-v5-prototype.html` — the exterior reference, approved by Tom 29 Oct 2026 ("apart from that it's good"). Where this plan and the prototype disagree, the prototype wins.** Its prices are placeholder maths; the elevation drawing is the reference for `Elevation.tsx` at thumbnail and sheet size.
3. This plan — how the two meet, and three decisions where they disagree (§4).
**Scope:** mobile `< 768px` only. Desktop exterior is untouched (except D-E1 if Tom rules it).
**Date:** 29 Oct 2026

---

## 1. Session 0 — state check (no code, stop and report)
The exterior v2 brief had its own six sessions (S0–S6) behind an `exteriorV2` flag. Before anything else, Claude Code records in the ledger:
- Which of exterior v2's S1–S6 are merged, and whether `exteriorV2` is on in production.
- Whether `Elevation.tsx`, `exterior_typicals`, `lib/wizard/exterior-model.ts` and the `home / paint / about / sides / walk` steps exist.
- Which exterior e2e specs are green today.

Then one of two paths:
- **A — exterior v2 is built:** sessions 1–6 below re-skin its screens for mobile. The desktop two-column exterior stays as is.
- **B — exterior v2 is not built (or partly):** build the missing v2 sessions first, mobile-first in the v5 shell, desktop in the refresh's two-column layout. Sessions below still apply; the model work (v2's S1) comes before them.
Report the path and WAIT FOR GO.

## 2. The mobile exterior flow (v5 shell, v2 questions)
One question per screen, auto-advance on single choice (D10), Continue on multi-select, Contact top-right, live strip under the bar. Exterior v2's step rail names stay as the progress stages: Your home · Painting · About it · Each side · Details · Your range · Tighten.

| # | Screen | From v2 | Mobile treatment |
|---|---|---|---|
| 1 | What are we painting? → Outside | — | as v5 |
| 2 | What kind of home is it? | 7.1 shape cards | nine cards, 2 per row, each with its silhouette thumb; picking one redraws the strip thumbnail as that house; auto-advance |
| 3 | About how big is it? | 7.1 size pills | five pills (Small … Not sure) with the m²/bedroom hint; auto-advance; thumbnail caption shows the typical sizes |
| 4 | Where is it in the row? | 7.1 row position | only for terrace / townhouse / unit; the thumbnail draws dashed "next door" blocks on shared sides; auto-advance |
| 5a–5d | Tap everything we're painting | 7.2 | **four screens:** On the house (walls, gable ends **and the roofline** — fascias, gutters, downpipes, eaves — on one screen, Tom's 29 Oct ruling) → Windows & doors → Verandah (posts, ceiling, handrail appear once verandah is ticked) → Around the house. Chips; nothing pre-ticked (C8b ruling); each tick sweeps that part in on the thumbnail (roller); tap the thumbnail to open the full elevation and tap parts there. Continue on each; Continue needs ≥ 1 part overall by 5d. |
| 6a–6n | Tell us about what you ticked | 7.3 cards | **one screen per card, only for ticked parts:** walls material (one; double storey: downstairs then upstairs as two screens, "Same as downstairs" first); painted or bare brick; gable fill; window type (thumbnail windows change); garage single/double; posts/columns/iron lace; extras' rough sizes (steppers). Thumbnail texture follows every answer. Auto-advance on single choice. |
| 7 | Colours? | 7.3 | as v5 |
| 8 | Access | 7.3 | the four chips; Continue |
| 9a–9d | Check each side — Front · Right · Back · Left | 7.4 | one screen per painted side; **the strip thumbnail turns to that side**, compass dot in the strip caption; chips for the whole-house parts on this side (removable), "+ Add something on this side", this side's wall material, "Not painting this side" (shared sides start that way). Button **Looks right — next side**. Opening the sheet shows the elevation of that side full width. |
| 10 | Where shall we send your range? | gate details | as v5 |
| 11 | Your range today | 7.5 → v5 gate | v5 gate rules: range in mono, basis line, small print, **"Want the exact number?"** · "A few minutes, side by side, nothing to measure. Then Sarah visits to run through the finer details and confirm it." · **Get my exact price** · "Or book a time with Sarah first" · three tiles · Sarah · trust · "What's in the range" collapsed, **one row per side** as v2 7.5 specifies. No picture. No tolerance. Scaffolding/lifts exclusion stays in the small print. |
| 12 | Tighten — the walk-around | 7.6 | one screen per side again: counts (windows, doors steppers), size (Looks right / Adjust / Not sure), **condition for this side** (v2 ruling: condition is asked here, per side, not pre-gate), **Check this side**. Strip thumbnail shows the side; sheet shows it full. Done → back to the range reading as the exact-price stage; Tighten becomes "Change a side" (v2 ⚑14). |

Notes
- Exterior does **not** get the v5 interior "condition" or "living there" screens pre-gate; condition is per side on Tighten (v2 ruling, 15 Sep / 12 Oct).
- "Both" jobs: inside v5 screens, then exterior screens 2–9, one details screen, one gate (v2 7.8).
- Copy rule R8 applies: one heading, at most one grey line. v2's longer hints become the sheet caption or are dropped.

## 3. The strip and thumbnail for exteriors
- The thumbnail **is `Elevation.tsx`** (v2 §8) rendered at 76×52 and again full-width in the sheet, from one state — not a second drawing. If path B, `Elevation.tsx` is built in v5 S3's layer convention (base layer + clipped painted layer per part) so the roller sweep works from day one.
- Roller sweep on every part tick (v5 §3.3), per-element animation handles, reduced-motion snap.
- Side turning: `elevation(side, …)` already takes the side; the strip shows the current side on 9a–9d and 12; front elsewhere.
- Ribbon text: "Outside · Californian bungalow · Medium · 9 parts" then "Front ✓ · Right ✓ · Back · Left" during each-side.
- Desktop: unchanged (the v2 right-rail picture), plus the roller sweep if v5 D14 = build.

## 4. Where the briefs disagree — decisions (⚑)
| ⚑ | Conflict | Default |
|---|---|---|
| **D-E1** | v2's range screen shows "Guide · within N%" and "Detailed" tier labels. v5 R2 bans any tolerance a customer can see. On mobile, v5 wins. **On the desktop exterior gate the labels currently stay** because desktop is out of scope — but R2 was given as a liability ruling, not a layout one. Remove on desktop too? | Remove on both (one-line copy change on desktop, no layout change) |
| **D-E2** | v2 7.5 lists four doors (Tighten · Book a site visit · Speak with us · Send a message). v5 gate has one button + "book a time with Sarah" link, with call/message in Contact. | v5 gate on mobile; desktop keeps v2's doors |
| **D-E3** | v2 says nothing is pre-ticked on Painting (C8b); v5 interior pre-ticks surfaces from the job. | Exterior stays un-pre-ticked (its ruling); interior stays pre-ticked |
| D-E4 | The gate body copy says "A few minutes" (v2 estimated ~3 min for the walk-around) vs interior's "Ten minutes". | "A few minutes" |
| D-E5 | ~~Verandah group placement~~ — settled 29 Oct: own screen, always shown; posts/ceiling/handrail appear once verandah is ticked. | — |

## 5. Sessions (path A; path B inserts v2 S1 before session 1)
Each: feature branch, failing spec first, gates green (`build`, `tsc`, `eslint`, `npm test`, named Playwright specs), desktop screenshot diff clean at 1470px, ledger row, Tom's phone check.

| # | Ships | Gate specs | Tom's phone check |
|---|---|---|---|
| 1 | **Your home on mobile** — screens 2–4 in the v5 shell; shape cards with silhouettes; strip thumbnail = `Elevation` at thumb size; size caption; row-position dashed blocks; skip rules. | `exterior-v2-home.spec.ts` at 390px | Pick each of the nine shapes; "does the little house look like that house?" |
| 2 | **Painting, four screens** — 5a–5d (house + roofline on one screen); roller sweep on part ticks in the thumbnail **without opening the sheet** (the v4 bug test); sheet with tappable parts; nothing pre-ticked. | `exterior-v2-paint.spec.ts` at 390px + a new `exterior-mobile-roller.spec.ts` | Tick a bungalow fully, watch each part paint in |
| 3 | **About it, one card per screen** — 6a–6n only for ticked parts; double-storey two-material screens; texture follows; colours; access. | `exterior-v2-about.spec.ts` at 390px | Change walls to render and watch the thumbnail |
| 4 | **Each side** — 9a–9d; strip turns to the side; remove/add parts; per-side material; not painting; Looks right. | `exterior-v2-sides.spec.ts` at 390px | Add a gable on the right side of a bungalow |
| 5 | **Gate (v5) + details** — screen 10–11; one row per side in "What's in the range"; no tolerance (D-E1); Contact's "book a time" from the gate; bigger-job variant per v5 D3. | `exterior-v2-range.spec.ts` at 390px; grep: no ± on mobile exterior | Whole quick path on his phone for a bungalow and a townhouse |
| 6 | **Tighten walk-around on mobile** — screen 12 per side; counts, size, condition per side; Check this side; done; "Change a side"; the after-range sides editor on Paint Home chrome reading v2 with nothing re-asked. | `exterior-v2-tighten.spec.ts`, `sides-editor.spec.ts` at 390px | Tighten the bungalow with the side gable; open as staff and see that line |
| 7 | **Both jobs, finish** — inside v5 then exterior mobile; combined gate; help files; full exterior suite + `outside-commercial.spec.ts` unchanged; independent check by a fresh agent against §6; screenshots to `docs/wizard-mobile/exterior/`; ledger closed. | all exterior specs; `both-stacked.spec.ts` | Final phone check: bungalow, townhouse, unit, and a both job |

## 6. Acceptance (390×780, iOS Safari + Android Chrome), adds to v2 §10 and v5 §9
- [ ] Every exterior screen is one question with ≤ 1 grey line; auto-advance on single choice; Continue only on multi-select, each-side and tighten screens.
- [ ] Strip thumbnail is the `Elevation` drawing; it changes on shape, size, row position, every part tick (sweep), every material/window/garage/posts answer, and turns to the side on each-side and tighten screens.
- [ ] Ticking a part sweeps it in the thumbnail without opening the sheet; tapping a part in the sheet ticks the chip; both stay in sync.
- [ ] Nothing pre-ticked on Painting; a material question never appears for an unticked part; a single storey is never offered a second material.
- [ ] No dollar figure before the details screen; no ± or tier label anywhere on mobile exterior.
- [ ] Gate: one row per painted side; a side marked not painting is absent; small print includes the scaffolding/lifts exclusion.
- [ ] Tighten: per-side condition, counts and size; cannot return as the exact-price stage until every painted side is checked; "Change a side" afterwards.
- [ ] Contact works from every exterior screen; a booking from screen 2 creates a lead carrying the shape.
- [ ] Desktop exterior screenshots at 1470px unchanged (D-E1 copy change excepted); `lib/pricing/**` untouched; `outside-commercial.spec.ts` green.

## 7. Reference prototype
`wizard-exterior-mobile-v5-prototype.html` — approved 29 Oct 2026. Commit it under `design/reference/` with this plan. Every session builds to it; Tom's phone checks compare against it.
