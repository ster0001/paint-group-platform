# Build plan — Estimator wizard mobile v5 + gate

**Companion to:** `claude-code-brief-wizard-mobile-v5.md` (what and why) and `painthome-wizard-v5.html` (the reference — open it at 390px before every session).
**Scope guard:** mobile `< 768px` only. Every session ends with a desktop screenshot diff at 1470px proving nothing moved (Contact relabel and session 6 excepted).
**Branch:** `feat/wizard-mobile-v5`. Worktree if another Claude Code session is open. Migrations only in session 1, between gate runs.
**Ledger:** append each session to `estimator-v2-progress.md`. Commit brief, plan and prototype to the repo today.

---

## Session 0 — Orientation (no code)
Read brief + plan; open the prototype; `grep` and record in the ledger every reference in brief §0; confirm the visit-booking slot API's shape and the messaging adapter's SMS call. Stop-and-report on anything missing.

## Session 1 — Skeleton: brand guard, desktop dock bug, events
Same as before and still first, because it fixes live defects and makes the rest measurable.
1. `brand` on the estimate/session record from the originating host; all `/estimate/*` chrome, tokens and copy strings pick from it. Grep test for "Paint Group" on Paint Home pages.
2. Remove the media query hiding `.wz-rv-dock` on desktop (interim: existing button renders inside the range card; desktop layout otherwise untouched).
3. Emit brief §8 events; wire the home dashboard "Where estimates go" to gate→exact and contact→booked.
- Ship to production at end of session.

## Session 2 — Mobile shell and screens (brief §2)
1. Mobile layout (`< 768px`): header (back · logo · Contact pill), 3px bar, strip placeholder, one-question screens, auto-advance (D10), bottom bar only on surfaces/rooms/details, safe-area padding.
2. The twelve screens with the exact headings, sub-lines, options and skip rules. Generated rooms list. Details step with validation and pre-fill hook.
3. Remove the sticky picture panel and the floating pill on mobile.
4. Answers persist across Back and reload ("Welcome back" still restores).
- Acceptance: §9 items 1–3; screenshots steps 1–11 at 390px; desktop diff clean.

## Session 3 — Live strip, thumbnail and roller (brief §3)
1. Strip component: 76×52 thumbnail + ribbon + chevron; sheet with full picture, caption and the same chips.
2. One picture state rendered to both; variants for property/storeys/colours/condition; surfaces as base + clipped painted layers.
3. Roller sweep with per-element animation handles; reduced-motion snap; Safari-safe (rAF on the rect attribute, not CSS on clipPath children).
4. Chips in step and sheet share state; ribbon count updates.
- Acceptance: §9 items 4–6 (the "sweeps in the thumbnail without opening the sheet" check is the one that failed in v4 — test it on a real iPhone, not just headless).

## Session 4 — Gate, mobile (brief §4)
1. Blocks 1–6 in order; no picture; small print; tiles; sticky "Get my exact price" bar.
2. "What's in the range" from ticked surfaces.
3. Bigger-job variant behind D3 (off on Paint Home).
4. Scope page header shows the three tiles with "Your exact price" active (chrome only — the scope redesign is its own brief).
- Acceptance: §9 items 7, 10, 11; desktop gate diff clean.

## Session 5 — Contact and early booking (brief §5)
1. Contact sheet: Sarah line, Book a visit, Call (tel:), Message, Save for later.
2. Two-field form when no name/mobile; skip to times when known.
3. Times from the visit-booking zone API (pre-set days only, D12 lead time); four on screen + More days.
4. Booking creates lead + visit, sends SMS via the messaging adapter, shows the Booked screen; Keep going returns to the same step; details step and gate pre-fill.
5. Gate "book a time with Sarah" opens the sheet at times. D13 path.
6. Desktop: relabel Help → Contact only.
- Acceptance: §9 items 8–9; API-level test that a booking from step 3 creates a lead carrying the three answers given so far.

## Session 6 — Optional: roller on the desktop picture (brief §6, D14)
Reuse session 3's layers and animation on the existing desktop right-rail SVG; no layout change. Skip entirely if D14 = leave.

## Session 7 — Home hero, check, ledger
1. Mobile hero: stacked address + button; suggestions overlay (brief §7).
2. Full E2E on both brands at 390px: Inside full path; Outside path; Unit path (storeys skipped); Contact booking from step 3 then continue to gate; gate → exact price → scope with Paint Home chrome.
3. Independent check by a fresh agent against brief §9 (the work doesn't grade itself); real-device pass on an iPhone and an Android for the roller and safe-area.
4. Desktop screenshot diff at 1470px; golden pricing tests; exterior order untouched.
5. Screenshots to `docs/wizard-mobile/`; ledger; PR linking brief, plan and prototype.

---

## Decisions that gate sessions
| ⚑ | Needed by | Default |
|---|---|---|
| D10 auto-advance | Session 2 | Auto-advance |
| D11 button label | Session 4 | Get my exact price |
| D12 earliest slot | Session 5 | Next pre-set day in zone |
| D13 post-booking path | Session 5 | Full path |
| D14 desktop roller | Session 6 | Build |
| D3 bigger-job ceiling | Session 4 | Off on Paint Home |
| D4 estimator name | Session 4 | Assigned estimator |

## How this fits the whole
Mobile is where most Paint Home traffic lands, and the gate is the hinge of the platform: everything downstream (exact price → scope → fixed price → booking → work order → invoicing → review) only happens if a customer gets through the wizard and taps the one button. Sessions 2–3 make the wizard fast and visibly responsive; session 4 makes the gate a price and one honest question; session 5 opens a second door — a visit — from any screen on the cheapest possible ask, which feeds the same visit-booking and CRM modules the rest of the platform already uses. Session 1's events put the whole funnel on the home dashboard so the next change is measured, not guessed.
