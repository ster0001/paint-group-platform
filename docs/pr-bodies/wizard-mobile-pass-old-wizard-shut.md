# Estimator wizard on a phone: every step resized, the talk bar a pill, the drawings larger — and the old page set shut to customers

**Tom, 25 Oct 2026.** Two reports from his phone: "the wizard needs to be completely improved and optimised for mobile — the font is off on boxes, the floating contact-us box is too big", and "when inputting my address in Paint Home it has taken me to the old estimator wizard — this needs to be completely removed and just the new one used". No migration.

## The old estimator wizard is shut to customers (`app/wizard/WizardApp.tsx`)
A customer on `/estimate` (either shopfront) is now ALWAYS on the quick look. Before this there were three doors onto the old five-page set — the one Tom hit was a resumed draft: a draft saved before the quick look (no `quickLook` answers and no `quick:` screen tag) resumed onto the old pages with "Welcome back".
- `entry` starts as `"questions"` for every customer (it used to be inferred from the resumed state and from a seeded `prefillState`, and both inferences could land on the old pages).
- The resume effect puts a customer on the quick look whatever the draft says; a draft from the old pages starts the quick look at screen 1 with its answers kept.
- `chooseEntry` (describe it / upload) is a no-op for a customer; the `?entry=upload` door and its "Upload photos or a listing" link are gone; `entryFromState` is deleted.
- Staff are unchanged: the internal `/wizard` (mode `internal`) still opens on the page set, as does the staff builder.

## The phone pass (`app/wizard/wizard.css`, the ≤900px block; `TalkCard.tsx`)
Checked step by step at 390×844 on the test stack, both paths.
- **The talk bar** was a full-width 52px bar sitting over the answer cards just above Continue, and it had `width: 100%` from the stage's stretch rule so it ran 12px off the right of the screen (a tap on a shape card below it opened the visit sheet instead). It is now a compact pill at the bottom right (avatar + the options as icons, 128×50); the words stay in the DOM, visually hidden (`.wz-talk-lbl`), so screen readers and the `ql-book` / `ql-call` / `ql-message` specs are unchanged. Laptop unchanged.
- **Boxes with the font off**: the two-up icon cards (kind of property, storeys, occupied) had 47px for their words beside the icon and broke mid-word ("Townh ouse", "Comm ercial", "Unit or apart ment"). On a phone the icon sits above the words (15.5px / 13px).
- **The drawings**: the picture band is 170px (was 150, with the elevation at 172) and every drawing is scaled to fill it: the exterior v2 elevation ×1.24 about the ground line (fills edge to edge, the chimney top still in), the room ×1.18 and the floor plan ×1.1 about the centre; the inside/outside house keeps #386's ×1.75. The pinned card is ~210–225px of 844 (under 40%), the page still scrolls on every step.
- **Type a notch smaller on a phone**: h1 27px (was 30), the lead 16px, question heads 18px; Continue 16.5px with no arrow so "Continue to the last question" fits on one line.

## Specs (`e2e/customer-journey/`)
- New: `exterior-v2-home.spec.ts` "on a phone the house is pinned under the step bar, larger, and the page still scrolls" — at 390×844 on home → paint → about → sides: nothing wider than the phone, the pinned card under 40% of the screen, the page scrolls, the elevation wider than the letterbox, the talk pill on screen and above the Continue bar, and after scrolling the card's top is the step bar's bottom.
- The old upload route had its own drives. `openQuickLook` no longer takes `{ entry }`, `openExteriorPages` no longer takes `{ via }`, and `toSidesEditor` (exterior-v2-drive.ts) is the one way to the sides editor: the drawn house → every side → the gate → the range → Tighten. Re-pointed at it: `sides-editor.spec.ts` (3), `tom-batch-8sep.spec.ts` (3 of 4), `parity-mechanics.spec.ts` (exterior), `doors-tiles-steppers.spec.ts` (exterior), `document-model.spec.ts` ("no floorplan field anywhere", now on the drawn house).
- Retired with the route (ruling: Tom, 25 Oct, the old wizard is removed for customers): `exterior-path.spec.ts` ("five exterior pages, no interior questions, priced by sides" — the pages themselves), and `tom-batch-7sep.spec.ts` test 2 ("targets → follow-ups → sides left unticked arrive NOT PAINTING" — the old page set's follow-up pages). The drawn house's path is `exterior-v2-*.spec.ts`.

## Proof
All on the C1 test stack, 25 Oct 2026, anonymous customer:
- `npx tsc --noEmit` clean; `npx eslint --max-warnings 4 .` 0 errors (the 4 pre-existing warnings).
- e2e, 12 spec files in one run against the branch (`next dev` :3102): **57 / 60** — the three reds were the dev overlay's badge intercepting a tap on Back at phone width (same-device resume) and two old "Yes" taps I had not yet removed; **re-run against the production build (`next start` :3104): 9 / 9** (`save-and-return` ×3 incl. the new old-draft / Paint Home case, `sides-editor` ×2, `tom-batch-8sep` ×4). The first run (before the Yes taps were removed) also had `document-model` 3/3, `tom-batch-7sep` 4 passed / 2 skipped, `doors-tiles-steppers` and `parity-mechanics` interior tests passing.
- Green in the 60: the new phone pin test (`exterior-v2-home`, 390×844 across home → paint → about → sides), every `exterior-v2-*` spec, `ui-refresh-baseline` at 390 and 1440, `parity-mechanics` and `doors-tiles-steppers` exterior on the drawn-house editor.
- Checked by hand in the browser at 390×844 (every quick-look step on both paths, the range, the sides editor) and at 1440×900 (unchanged: the 4:3 picture, the talk bar with its words).
- Noticed in passing, not changed: on the drawn-house path the front side's tiles carry Fascias but not Gutters even though gutters were ticked (the add panel offers "+ Gutters" as a first run) — `defaultSidesForPart` says all four sides; worth a look in the sides mapping. The 8 Sep spec adds the first run before expecting the second.

## Manual test (Tom, on the phone)
1. painthome.com.au → type an address → See my price: the quick look ("Let's price your painting"), never "Step 1 of 5 · The property" with Interior / Exterior / Both and Describe it / Answer a few questions / Upload.
2. On a phone that had an old draft: the same — "Welcome back" and the quick look at screen 1.
3. Outside → the place: "Townhouse" and "Commercial" whole, icon above the words.
4. Pick a shape: the house fills the picture edge to edge and stays under the step bar while you scroll, on Your home, Painting, About it, Each side.
5. The talk pill (PG + two or three icons) sits at the bottom right above Continue; nothing is under it that you cannot scroll to.
6. Inside → the job and condition steps: the room drawing fills most of the band; the rooms step: the plan a little larger.
7. Laptop: nothing changed (the bar with its words bottom right, the 4:3 picture).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
