# Addendum — Desktop wizard takes the one-press cards (adds to `claude-code-brief-wizard-mobile-v5.md`)

**Status:** addendum, 5 Nov 2026. The mobile v5 build is complete; this adds one change to the desktop (`≥ 768px`) wizard and changes nothing on mobile.
**Supersedes:** v5 brief R1 ("mobile only; desktop unchanged") and §6/D14 (desktop roller "optional") — for the wizard only. The quote stage's desktop is covered by `claude-code-brief-quote-stage-v10.md` R8.
**Reference:** `wizard-desktop-onepress-prototype.html` (approved by Tom 5 Nov). Where this text and the prototype disagree, the prototype wins.
**Rebuilt on what exists, left clean (R0 of the quote-stage brief applies):** reuse the mobile v5 card router, cards, copy, skip rules, picture components and events. No desktop-only copies of any of them.

## 1. What changes on desktop
Keep the current desktop layout exactly: header with the six step pills + "Your range", Contact and Save & book; progress line; question left; right rail with the picture, "Your job so far" (with Change links) and Sarah.

Inside that layout:
1. **One question per screen** — the same twelve screens, order, copy, options and skip rules as mobile (v5 brief §2), driven by the same router. The step pill highlights the step the current question belongs to (Place = property · bedrooms · storeys, and so on) and ticks when its last question is answered.
2. **Single-choice cards advance on click** (~260ms), as on mobile. Continue stays only on surfaces, rooms and details. "Show my range" on details.
3. **Keyboard:** each option card shows a small key number top-right; 1–5 choose, Enter = Continue/Show my range, ← = back; the name field is focused when details opens. A one-line grey key hint sits under each card.
4. **Live picture in the right rail:** the existing right-rail picture takes the roller sweep on surface ticks and the same variant changes (property, storeys, colours, condition) as the mobile strip thumbnail. Reduced-motion snaps. Caption shows "N surfaces ticked".
5. **"Your job so far"** updates after every answer; Change jumps to that question.
6. Gate copy on desktop reads "Want the detailed number?" / **Get my detailed price** (R1 of the quote-stage brief).

Not changed: desktop gate layout, Contact sheet, exterior question order, pricing, data model.

## 2. Size
**Small — one session, two at most.** Reason: the one-question router, cards, copy, skip rules, auto-advance, picture variants and roller sweep all shipped in the mobile build. Desktop today renders several questions per step; the work is to mount the mobile router inside the desktop two-column shell, map questions to step pills, add the key handlers and hints, and attach the existing sweep to the rail picture. The only genuinely new code is the keyboard layer and the pill mapping — a few dozen lines.

## 3. Fewest steps
| # | Ships | Check |
|---|---|---|
| 1 | Desktop renders the mobile router inside its two-column shell; step pills mapped and ticking; single-choice auto-advance; Continue only on the three multi/form screens; rail picture with sweep + variants; "Your job so far" live; gate copy. Keyboard layer (keys, hints, focus). Remove the desktop-only grouped-step components and their styles/tests once the flag is on (grep evidence in the PR). Flag `wizardDesktopOnePress`. | Laptop run start to gate without the mouse; Change from the rail; phone unchanged |
| 2 (only if needed) | Exterior path on desktop verified against the exterior mobile v5 pattern (shape cards, grouped parts, each side with the picture turning) if session 1 shows the exterior screens need their own pill mapping. | Bungalow and townhouse on a laptop |

## 4. Acceptance
- [ ] 1366px: twelve screens in the v5 order; skip rules hold (Unit skips storeys; Outside skips job/rooms); single-choice advances on click; Continue only on surfaces/rooms/details.
- [ ] Step pills highlight by question group and tick on completion; "Your range" pill lights on the gate.
- [ ] Keys: 1–5 pick, Enter continues when enabled, ← goes back, details focuses name; hints visible under each card; nothing fires while typing in a field.
- [ ] Rail picture sweeps on every surface tick and changes with property/storeys/colours/condition; reduced-motion snaps.
- [ ] "Your job so far" reflects every answer; Change jumps correctly.
- [ ] Desktop gate otherwise byte-identical to pre-change except the detailed-price copy; mobile screenshots byte-identical.
- [ ] No duplicated card, router or picture components; old grouped-step desktop components removed once the flag is on.

## 5. Decisions (⚑)
| ⚑ | Question | Default |
|---|---|---|
| D-D1 | Auto-advance delay on desktop (mobile is ~250ms) | 260ms |
| D-D2 | Show key numbers on cards always, or only after the first keypress | Always (they're small) |
