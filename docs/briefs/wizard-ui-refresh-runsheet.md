# Wizard UI refresh — run sheet for Claude Code

**Tom: paste this whole file into a Claude Code chat as the first message. It runs the plan one session at a time and stops at every gate. To continue in a later chat, paste only the lines in §7.**

Plan: `docs/briefs/claude-code-brief-wizard-ui-refresh.md` (the brief). Ledger: `docs/briefs/wizard-ui-refresh-progress.md`. Approved design: `design/reference/estimator-wizard-redesign-mockup.html`. Written against `main` at `ed5a94c`, 9 Oct 2026.

---

## 1. Read this first: how every session works

You are executing a fixed plan, one session per chat, in order. This is a **presentation-layer change**: the wizard asks the same questions, sends the same payloads and prices to the same cents. Only layout, styling, pictures and motion change.

**The loop for every session, without exception:**

1. **Preflight** (§3). Report, then **wait for Tom to say go**.
2. **Build the one session** Tom names, to its block in §4 and nothing else.
3. **Gate** (§5). Report actual output, and the unit-test count before and after.
4. **Show the diff and wait** for approval before committing. Open a PR. The PR body lists every ⚑ the session touched, every spec you edited and why, and screenshots at 390px and 1440px of each screen you changed.
5. **Ask Tom to walk it on the preview deploy on his phone.** The line marked *Tom's check* says what to look for. Do not merge before he confirms.
6. **Postflight** (§6): update the ledger row, commit it in the same PR, and **stop**. Do not start the next session in the same chat.

**The contract for this plan:**

- **Files you may change:** `app/wizard/**`, `app/estimate/**` (components and pages, not route handlers), new picture and shell components under `app/wizard/`, `e2e/**` only as each block allows, `docs/briefs/wizard-ui-refresh-*`, `docs/help/estimator/**`.
- **One new file is allowed in `lib/`:** `lib/wizard/ui-flags.ts`, typed constants for the switches in the decisions sheet. No Settings row, no migration.
- **Files you may not change:** `lib/pricing/**`, everything else in `lib/wizard/**`, `app/api/**`, `supabase/**`, `proxy.ts`. A diff that touches any of these is a **STOP and report**.
- **No migrations in this plan.** If a session thinks it needs one, STOP.
- **The step order comes from `stepsFor()`** in `lib/wizard/quick-look.ts`. Never hard-code a step list in the UI. If the mockup and `stepsFor()` disagree, the code wins and you report the difference.
- **Hooks survive.** `docs/briefs/wizard-ui-refresh-test-hooks.md` lists every class and test id the e2e specs use. A hook may move to a new element that does the same job; it may not disappear. A spec may change only where it asserts wording Tom changed under ⚑ 7.
- **Rulings in the brief's §4 outrank the mockup.** If they conflict, STOP and report.
- **Switched-off features stay off.** Anything gated in `ui-flags.ts` ships with its default from the decisions sheet until Tom's answer is written there.

**Standing rules from `CLAUDE.md`, restated because these are the ones sessions break:**

- A referenced file that does not exist is a **STOP and report**, with the path. Never reconstruct it from memory.
- e2e never runs without `E2E_BASE_URL`, and never against production. Only one worktree runs e2e at a time: if the run lock is held, wait once and report. No background retry loops.
- Work in your own worktree with its own port and a full `npm install`.
- Shared components take a `mode` prop (staff | customer). Never fork a component into two copies.
- No "while I was in there". Anything outside the block goes in `docs/briefs/estimator-v2-parking-lot.md` as one line with file:line, prefixed `UI refresh:`.
- Copy is English tone (not Australian). Money is AUD including GST. The estimator's name and the phone number come from records and Settings, never typed into a component.
- Help is part of done (Session 9).

**Staying on track:**

- The block is the contract. If it cannot be done as written, STOP, say why with file:line, propose the smallest change, and wait. Do not redesign.
- Other sessions are changing the wizard this month. If the preflight finds a merge since the last ledger row that touches your files, say what changed and re-read those files before you build.
- If a test that was green goes red and it is not yours, report it. Do not fix it unless it is inside this session's files.
- Every reply ends with exactly one of: `WAITING FOR GO`, `WAITING FOR DIFF APPROVAL`, `WAITING FOR PHONE CHECK`, `BLOCKED: <reason>`, or `DONE — ledger updated`.

---

## 2. Step 0: the reference files must exist

Before the first preflight, confirm each of these resolves. Print the list with ✓ or ✗. **Any ✗ is a STOP.**

    docs/briefs/claude-code-brief-wizard-ui-refresh.md
    docs/briefs/wizard-ui-refresh-runsheet.md
    docs/briefs/wizard-ui-refresh-progress.md
    docs/briefs/wizard-ui-refresh-decisions.md
    docs/briefs/wizard-ui-refresh-components.md
    docs/briefs/wizard-ui-refresh-test-hooks.md
    design/reference/estimator-wizard-redesign-mockup.html
    design/reference/estimator-journey-v2.html
    docs/briefs/rebuild-addendum-confirm-loop.md
    docs/briefs/claude-code-brief-visit-booking-addendum-a.md
    lib/wizard/quick-look.ts
    lib/wizard/ladder.ts
    app/wizard/wizard.css

---

## 3. Preflight: run at the start of every session

    Read docs/briefs/wizard-ui-refresh-progress.md. Take the last row whose
    status is not TODO. Then, before touching code, report in one block:
    1. git log --oneline <that row's SHA>..origin/main -- app/wizard app/estimate
       lib/wizard e2e/customer-journey — what has landed since, file by file.
    2. Any open branch or PR touching app/wizard or app/estimate.
    3. The next session to run, and anything in its block the repo has already
       done. Shrink the block accordingly and say what you removed.
    4. stepsFor() output for: interior, exterior, both, each ranged segment,
       warehouse, each visit-only segment, hospital, commercial outside.
       Flag any path that differs from brief §7.7.
    5. Regenerate the hooks list (command at the top of the test-hooks file).
       Report hooks added or removed since the file was written.
    6. Read docs/briefs/wizard-ui-refresh-decisions.md. List each ⚑ this
       session depends on, Tom's answer if there is one, else the default.
    7. Open the mockup at 390px and 1440px. For each screen this session
       names, pick the job type and screen from the bar at the top and read
       it. Confirm you are building to the mockup, not to a description.
    Wait for confirmation before starting.

---

## 4. The sessions

Each block: what to build, where, what not to touch, the gate, and what Tom checks on his phone. Section numbers (§7.x, §10) refer to the brief.

### S0 — Commit the pack; baseline screenshots

- **Build:** nothing. Commit the hand-over pack: the seven files in the first block of §2, plus `docs/briefs/wizard-ui-refresh-overview.md`. Add `e2e/customer-journey/ui-refresh-baseline.spec.ts`: as an anonymous customer at 390px and 1440px, capture a full-page screenshot of every row of brief §7.13 and §7.12 into `ui-refresh-shots/before/<width>/` (gitignored; not `test-results/`, which Playwright empties on every run). This is the "before" set for the final PR. **Ruling 9 Oct:** the set is re-taken once `fix/customer-journey-gate-9oct` is merged, so it photographs the `main` that S1 builds on.
- **Also report:** the hooks diff from preflight item 5, and any difference between `stepsFor()` and brief §7.7.
- **Gate:** build, typecheck, lint, unit tests; the new baseline spec passes.
- **Tom's check:** open the mockup file on your phone and tap through all six job types on the "Job type" row. Reply "mockup approved" or list changes. **Nothing is built until you do.**

### S1 — The shell, on every path

- **Build (brief §5, §7.1, components doc §2–§3):** new tokens on `.wz`; header with step rail driven by `stepsFor()`, progress stripe, phone progress row; two-column step layout with an empty right column; option cards, chips, segmented controls, count rows, follow-up boxes, fields, drop boxes; Back and Continue inside the column on desktop and as the phone bottom bar; the "why Continue is unavailable" line; chat as a header icon (⚑ 10). Sentence-case hints replace every all-caps `wz-opt` hint.
- **Applies to:** every `QuickLook` step and every `CommercialScreens` screen. Same content, new layout.
- **Starts only when** `fix/customer-journey-gate-9oct` is merged and the existing wizard e2e pass on `main`, and the S0 before set has been re-taken (ruling 9 Oct).
- **Capitals (ruling 9 Oct):** segment kickers stored in capitals are sentence-cased on screen only (CSS); the seed/row wording is a separate change for Tom to approve.
- **Staff mode:** the older page list in `WizardApp.tsx` stays single-column via a modifier class (⚑ 21). Check it still works.
- **Remove from the customer path (keep the hooks):** the `.wz-dots` row, the floating "Step x of y" line, the dashed "Would you rather talk it through?" box (its three actions move into the right column in S2; until then, show them as a compact card under the nav so `ql-book`, `ql-call` and `ql-message` stay reachable).
- **Do not touch:** the editors, the range screen, any picture.
- **Gate specs:** `gate`, `simpler-form`, `hydration-early-click`, `save-and-return`, `holding-and-honest-defaults`, `human-moments`, `reach-and-chat`, `pending-indicator`, `funnel-dropout`, `confirm-rooms`, `some-rooms`, `needs-work-15sep`, `exterior-quick-look`, `commercial-segments`, `commercial-warehouse`, `commercial-briefs`, `outside-commercial`, `staff-wizard-new-editor`. Add `ui-refresh-steps.spec.ts`: for every path in §7.7 the rail's step count and labels equal `stepsFor()`.
- **Tom's check:** on your phone and on a laptop, walk the inside steps and one commercial type. Two columns on the laptop; one tidy column on the phone; Continue never full-width on the laptop; nothing in capitals mid-sentence.

### S2 — The live picture and "Your job so far" (home, inside)

- **Build (brief §7.2, §6; components doc §4):** `HousePicture`, `RoomPicture`, `PlanMap` as inline SVG components with no library; the picture card; "Your job so far" with Change links; the Talk it through card in the right column. Floorplan reading and the zoomable plan move into the picture card on the Rooms step (brief §7.12, first row).
- **Flags:** colour try-on swatches behind `ui-flags.colourTryOn` (⚑ 1, default off).
- **Rules:** pictures are `aria-hidden` and never the only carrier of an answer. `prefers-reduced-motion` removes all motion. The picture box has a fixed 4:3 ratio so nothing shifts when it changes.
- **Gate specs:** S1's list, plus `plan-panel`, `tom-batch-7oct`, `document-model`. Add assertions to `ui-refresh-steps.spec.ts`: ticking and unticking each surface on the Job step toggles the matching picture element's state.
- **Tom's check:** on the Job step, untick Ceilings and watch the ceiling go back to "today". On the Rooms step, untick a room and watch it go dashed. On the phone the picture sits above the question and is not taller than about a fifth of the screen.

### S3 — The range screen, every path

- **Build (brief §7.4, §7.8–§7.10):** range card with the one count-up; the ladder (three bars for home inside; two bars and the visit sentence for outside, both and commercial); part ranges for "both"; the commercial note; the doors with Tighten my price as the one cyan card; the dark estimator strip; the three cards; What we'll do in two columns.
- **Flags:** "A job like yours" behind `ui-flags.similarJobCard` (⚑ 2, ⚑ 14, default off; when off the row is two cards wide). Trust card wording follows ⚑ 5's default.
- **Keep:** every door's test id and its visibility rule; `door-keep`; `reveal-range`, `reveal-restatement`, `reveal-assumed-toggle`, `reveal-kicker`, `reveal-parts`, `reveal-tiers`. The existing "roller reveal" is the one motion moment on this screen; keep it or replace it with the count-up, not both.
- **Gate specs:** `ladder`, `range-envelope`, `reveal-book-link`, `what-we-do`, `one-confidence`, `save-and-book`, `response-contract`, `retail-send`, `gate`, `exterior-quick-look`, `commercial-segments`.
- **Tom's check:** finish an inside job, an outside job and an office job. The price is the first thing you see; one obvious button; outside and office show no "Confirmed" bar and no "Speak with us".

### S4 — Room by room (and area by area)

- **Build (brief §7.5, §7.12; components doc §5):** two-column editor; right rail with the price card (range, accuracy pill, band with the dashed starting range, checklist, the two buttons), "Your home" card, estimator card; accordion room cards with the three numbered blocks; tile order and sizes; quick questions one at a time; last checks; the phone range strip and bottom bar. Room extras and extra prep (`RoomExtras`, `RoomSpots`) as the closed-by-default blocks in §7.12. Site and access as its own card. The cornices fix (the whole-home answer sets the room tiles).
- **Hook contracts (brief §10):** `.sc-freeze` pinned with `.sc-num` and `.il-prog` on screen; `range-width` parses to a number; `.il-prog` reads `N OF M`; `.sc-stick` holds exactly two buttons and exists once; `estimator-strip` keeps its id in the rail.
- **Covers commercial areas:** same component, segment's areas, no robe block, "Area by area" (⚑ 17).
- **Gate specs:** `r5-editor`, `room-card`, `interior-loop`, `interior-addpanel`, `doors-tiles-steppers`, `dark-to-light`, `trims-base`, `job-extras`, `room-spots`, `site-access`, `tighten-c10`, `batch-edits`, `openings-priced`, `parity-mechanics`, `finalise-gate`, `plan-panel`, `perf-wizard-editor`.
- **Tom's check:** on a laptop the right half is never empty and the header is one slim bar. Confirm two rooms: the band narrows, the plan rooms turn cyan, the next room opens by itself. On the phone the range strip stays visible while you scroll.

### S5 — Home, outside

- **Build (brief §7.8):** the Outside step's layout (cards, chips, count rows, follow-up boxes, window-type picture cards using the existing drawings); the house picture drawn element by element with materials, storeys and colour tone; the view from above on the Sides step; the side-by-side editor (`SidesEditor.tsx`) in the S4 layout with its side card blocks, wall shares, notes and photos, freestanding extras and last checks.
- **Keep:** nothing pre-ticked on "On the house" or materials; "No, leave it off"; "Not sure" on size (⚑ 16); every `ext-*`, `side-*`, `sides-q*` hook.
- **Gate specs:** `exterior-path`, `exterior-quick-look`, `exterior-batch-15sep`, `sides-editor`, `tom-batch-15sep-evening`, `what-we-do`.
- **Tom's check:** tick the body, windows and a picket fence and watch each appear painted. In the editor, set two wall materials on the front and make them add to 100%; leave the right side off and see it go dashed on the view from above.

### S6 — Home, both

- **Build (brief §7.9):** the choice screen as two door cards; part ranges on the range screen and the price card; the **stacked** editor: inside, then "Now the outside, one side at a time", one open card at a time across the page, the two chips as jump links, one combined count, one pair of buttons; the "Your home" card showing the plan with the view from above under it.
- **Gate specs:** `both-stacked` (must pass unchanged), plus S4's and S5's lists.
- **Tom's check:** on a "both" job, the rooms and the four sides are on one page; confirming the last room opens the front; the three ranges add up.

### S7 — Commercial

- **Build (brief §7.10, §7.11):** Space (eight tagged cards, "Which part?", the visit-only follow-up); Areas (kind question, count rows, open-space follow-up, also chips with their flags); Building (warehouse) with the warehouse picture; Job; Questions; Book; Booked; the area plan picture; the commercial variants of the range and finalise screens.
- **Rule:** every label, hint and option is read from the segment row at runtime. Grep your diff for any segment wording typed into a component; there must be none.
- **Gate specs:** `commercial-segments`, `commercial-warehouse`, `commercial-briefs`, `outside-commercial`, `warehouse-console-visit`, `retail-send`. Extend `ui-refresh-steps.spec.ts` to walk every segment for inside, outside and both, and the hospital path.
- **Tom's check:** walk office, warehouse and strata on your phone. Then healthcare → Hospital, and any type with "Outside": both should go to questions and a booking with no price shown anywhere.

### S8 — Supporting screens and pieces

- **Build (brief §7.12):** the sheet pattern, applied to `TalkSheet`, `SaveAndBookSheet`, `ContactCard`, `ReachStrip`, the finalise prompt and both chat panels; inline offers; the all-done banner; "From what you told us" tags; the guardrail outcome screen; Sent to your estimator; Book a time; the holding page; resume, error and slow-connection lines. Assistant page: tokens only (⚑ 22).
- **Parked here from S0 (ruling 9 Oct):** (a) before touching `HardStop` / `CustomerResult`, first report whether a customer can reach the "can't price this online" screen at all; if not, log it as a finding and do NOT redesign it. (b) Photograph the floorplan being read using a sample plan from the test files. (c) The "From what you told us" tag (`wz-assumed-tag`).
- **Gate specs:** `reach-and-chat`, `save-and-book`, `save-and-return`, `human-moments`, `holding-and-honest-defaults`, `assistant-widget`, `visit-requests`, `reveal-book-link`. Add `ui-refresh-coverage.spec.ts` (brief §10, "Nothing left behind").
- **Tom's check:** open "Send a message" and "Save & book" on phone and laptop: a panel from the right on the laptop, a sheet from the bottom on the phone, never a full-page takeover. Finish an estimate and read the "Sent" screen.

### S9 — Finalise, visit, clean-up, help

- **Build (brief §7.6):** the Finalise screen for every path; the visit booking page in the new shell with no change to slot rules. Delete `.wz-dots`, `.wz-rather`, `.wz-steps` and the 640px `.wz-wrap` cap from `wizard.css` and from every component. Rewrite `docs/help/estimator/customer.md` and `commercial.md` from the real screens using `docs/help/_template.md`.
- **Final checks:** every box in brief §10. Lighthouse mobile ≥ 90 on `/wizard` and `/estimate/scope`. **S9 runs in the same worktree as S0** (`../paint-group-platform-uirefresh`), because the before set lives only there. Re-run the S0 baseline spec with `UI_REFRESH_SET=after` into `ui-refresh-shots/after/` and put the before and after pairs in the PR, one per row of brief §7.13.
- **Gate specs:** the whole of `e2e/customer-journey`, `visit-booking-api`, `visit-calendar-gating`, `visit-schedule`, `visit-zones`, `perf-wizard-editor`, `staff-wizard-new-editor`, `ui-refresh-steps`, `ui-refresh-coverage`; `npm run help:index -- --check`.
- **Tom's check:** one complete job of each of the six types on your phone, start to finish, then the same on a laptop. This is the sign-off for the whole plan.

---

## 5. Gate commands

    npm run build
    npx tsc --noEmit
    npm run lint
    npm test                       # report the count before and after
    E2E_BASE_URL=<this worktree's URL> npx playwright test <the session's specs>
    npm run help:index -- --check  # S9 only

A named spec that does not exist is reported, not guessed at. Unit tests and e2e that were green before the session must be green after it, apart from the wording edits allowed under ⚑ 7.

---

## 6. Postflight: the last act of every session

    Add the row to docs/briefs/wizard-ui-refresh-progress.md: session, status
    DONE / PARTIAL / BLOCKED, date, merge SHA, unit count before → after,
    specs added or edited (and why), ⚑s touched and the value each shipped
    with, and one line of "what the next session should know".
    Append out-of-scope findings to docs/briefs/estimator-v2-parking-lot.md,
    one line each with file:line, prefixed "UI refresh:".
    Commit both in the same PR. Then stop.

End the reply with `DONE — ledger updated` and the next session's name.

---

## 7. Tom: what you paste in every later chat

    Continue the wizard UI refresh run sheet at
    docs/briefs/wizard-ui-refresh-runsheet.md. Run §3 preflight and wait.

Then, once you have read the preflight: **`Go: S<n>`**. Nothing else is needed.

**Your part between sessions:** walk the preview deploy on your phone against *Tom's check*; approve the diff; write any ruling into `wizard-ui-refresh-decisions.md` (or tell the session and it will write it). There is no SQL to paste in this plan.

---

## 8. Finishing

The plan is done when S9's row says DONE and Tom has signed off all six job types on a phone and a laptop. Turning the wizard on for the public is a separate step: Settings → Estimates → Online estimates, and the checklist in `docs/briefs/wizard-public-switch-checklist.md`. This plan does not flip that switch.

After S9, three follow-ups wait for a ruling: the trade lane in the portal (⚑ 20), staff mode (⚑ 21), and the assistant page's layout (⚑ 22).
