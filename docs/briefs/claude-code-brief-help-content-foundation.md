# Claude Code brief — Help content foundation (training manuals v1)

**Status:** ready to run
**Scope of this brief:** Phase A only (convention + backfill + GIF process). Phases B–D are described so nothing built now blocks them, but they are NOT to be built under this brief.
**Owner decisions:** flagged ⚑ throughout. Where a ⚑ blocks a session, stop and report — do not invent the answer.

---

## 0. Kickoff ritual (unchanged)

1. Read every file in §2 in the order given.
2. If any file in §2 is missing from the repo: **STOP and report** the missing file list. Do not proceed on memory of what it "probably says."
3. Confirm the file list back before writing any code or content.
4. Commit this brief to `docs/briefs/claude-code-brief-help-content-foundation.md` first.

---

## 1. Purpose and principles

We are building training manuals for staff and contractors on how to use each feature of the platform. Later, the same content becomes the searchable knowledge base behind the assistant (for staff, contractors, and customers on their own logins) and the script for walkthrough videos.

**One source of truth.** Every piece of help content lives as markdown in the repo at `docs/help/<feature>/<role>.md`. The in-app help centre, the assistant's retrieval corpus and the videos are all generated from these files. There is never a second copy anywhere.

**Written from what shipped, not from the briefs.** Help files describe the real screens. The first draft of every help file is written by Claude Code after running the flow end-to-end in the real role (the same e2e-first rule that governs feature work). Briefs are background reading only; where a brief and the running app disagree, the app wins and the discrepancy is reported.

**Role-scoped by construction.** Contractors never see office-only content (margins, charge-out rates, PC console, customer money views). Each role gets its own file; there is no "shared" file with sections hidden by role.

**Help is part of definition of done.** From the day this brief lands, a feature is not done until its help files are updated. This is the only part of the brief that gets more expensive the longer it waits.

**Regenerable over polished.** Walkthroughs are animated GIFs produced by Claude in Chrome from the real app, so they can be regenerated in minutes when a screen changes. Voiced video is deferred (Phase D).

---

## 2. Reference files (read in this order)

1. `CLAUDE.md` — engineering standards, STOP-and-report rule, e2e-first rule. This brief adds to it (§4, session A1).
2. `docs/briefs/engineering-standards-and-audit-brief.md` — definition-of-done conventions this brief extends.
3. `docs/briefs/post-wizard-buildout-order.md` — module order; help backfill follows the same order.
4. The scheduling + contractor portal brief (phases A–F) — locate it under `docs/briefs/`; if not present, STOP and report.
5. `docs/briefs/claude-code-brief-wo-loop-pc-command.md` (v4, six-stage model) — the work order loop is the second backfill target.
6. `docs/briefs/claude-code-brief-assistant-agent.md` + addendum A — Phase B hooks the help corpus into support mode; read so the file layout you create here is compatible with retrieval later. Do not build any of it now.
7. Design tokens (Switzer / Martian Mono; ink, graphite, raised, line, text, muted, cyan, amber, emerald, clay) — needed only so state names in help text match the colours on screen.

---

## 3. Rulings already made (do not re-ask)

- Contractors read help **inside the platform only**. No PDF packs, no printed onboarding.
- Customers get help **through the assistant on their own logins** (Phase B). No customer help route in v1.
- Tom will **not record** anything. All walkthrough media is produced by Claude in Chrome (GIF) or, in Phase D, AI voiceover over Claude-in-Chrome footage.
- Voiced video is limited to the day-one contractor flows and is built only after the WO loop has exited its proving window.
- Backfill covers **stable, in-use modules only**: scheduling + contractor portal A–F, contractor self-invoicing, and the work order loop once v4 has landed. Wizard, customer portal, trade portal v2, invoicing and CRM are **out of scope** until each exits its proving window.
- Customer-facing tone (and contractor-facing, since they represent the brand): plain English, English (not Australian) idiom. Staff-facing tone can be internal but still plain.
- Money, where it appears in help text, is AUD including GST.

---

## 4. Phase A — build now

### Session A1 — the convention

**Do:**

1. Add to `CLAUDE.md`, under definition of done:
   > A feature is not done until `docs/help/<feature>/<role>.md` exists or is updated for every role that can see the feature. The help file is written after the e2e run, from the real screens, using the template in `docs/help/_template.md`. If the running app disagrees with the brief, the help file follows the app and the discrepancy is listed in the session report.
2. Create `docs/help/_template.md` (§6 below, verbatim).
3. Create `docs/help/README.md`: the folder convention, role list, naming rules, front-matter spec (§6), and the rule that a feature's help files ship in the same PR as the feature.
4. Create `docs/help/_index.json` generator: a small script (`scripts/help-index.ts`) that walks `docs/help/`, validates front-matter, and emits an index (feature, role, title, summary, last-verified commit, GIF paths). Run it in CI; fail the build on invalid front-matter or a `role` value outside the allowed set. Phase B reads this index.

**Roles (allowed values):** `staff`, `pc`, `contractor`, `customer`. `pc` (project coordinator) is a specialisation of staff: where a screen is PC-only, write `pc.md`; where it's all office staff, write `staff.md`. Never both for the same content.

**Acceptance criteria:**
- CLAUDE.md line present; README and template committed.
- `npm run help:index` produces `_index.json` with zero files (folder empty) and passes CI.
- A deliberately malformed test file fails the index script with a readable error, then is removed.

### Session A2 — backfill: scheduling + contractor portal

**Do:** run the full contractor flow end-to-end as a real contractor account (offer received → accept/decline/propose → 24h SLA behaviour → booking confirmed → self-invoice with own company details). Run the staff side as a real staff account (timeline calendar, drag-drop booking request, customer confirmation after contractor accepts).

Then write:
- `docs/help/scheduling/staff.md`
- `docs/help/scheduling/contractor.md`
- `docs/help/self-invoicing/contractor.md`
- `docs/help/self-invoicing/staff.md` (what the office sees and how it's reconciled)

Every step that has a screen gets a screenshot at `docs/help/<feature>/media/<role>-<step>.png`, captured from the real app in the real role. Screenshots must not show margin, charge-out or customer money in contractor files.

**Acceptance criteria:**
- Every file validates against the template and index script.
- Every screenshot is from the current deployed build and named per convention.
- Session report lists any place the app diverged from the scheduling brief.
- A contractor file, read cold by someone who has never used the platform, gets them from "I received an offer" to "I've sent my invoice" without asking anyone. (Tom reviews this one himself.)

### Session A3 — backfill: work order loop

**Prerequisite:** WO loop v4 (six stages) merged and its e2e green. If not, STOP and report; do not write help for an unfinished stage machine.

**Do:** e2e in each role, then write:
- `docs/help/work-orders/contractor.md` — offer review, pre-start checklist (colours first), per-surface ticks, before-photos-before-first-tick rule, raising a variation, daily update drafts, QA checks, walkthrough mode (handing the device to the client), what "wrapping up" means.
- `docs/help/work-orders/pc.md` — six lanes, attention queue, what amber/clay/cyan mean on a card, pricing a variation, approving a drafted update, deemed-clock behaviour (neutral wording; deemed execution is OFF), Mode B remote sign-off gate.
- `docs/help/work-orders/staff.md` — only if there is office content that isn't PC-only; otherwise omit and say so.

**Acceptance criteria:** as A2, plus: every state name in the help text matches the enum value and on-screen label exactly (a test may grep the help files against the stage enum).

### Session A4 — GIF walkthrough process

**Do:**
1. Write `docs/help/README.md#walkthroughs`: how a walkthrough GIF is produced — Claude in Chrome runs the help file's steps in the real role against the deployed build, records with `gif_creator`, exports to `docs/help/<feature>/media/<role>-walkthrough.gif`, and the help file's front-matter `walkthrough:` field points at it.
2. Produce walkthrough GIFs for every help file created in A2 and A3.
3. Add a `verified_at_commit` front-matter field, set by the index script from git at generation time, so stale walkthroughs are detectable: CI warns when a feature's source files changed after `verified_at_commit`.

**Constraints:** GIFs are silent with on-screen captions only (no voiceover in Phase A). Target under 60 seconds each; split a flow into two GIFs rather than exceed it. Test data only — no real customer names, addresses or amounts in any recording.

**Acceptance criteria:**
- Every help file from A2/A3 has a walkthrough GIF that plays and matches its steps.
- Stale-walkthrough CI warning demonstrated by touching a scheduling component and observing the warning.

---

## 5. Phases B–D — described, not built

Do not start these under this brief. They are here so Phase A's file layout is compatible.

**Phase B — knowledge base via the assistant.** The help corpus (`_index.json` + markdown bodies) becomes a retrieval source for the assistant's support mode. Role filtering uses the same identity the assistant already has; a contractor's question only retrieves contractor files, a customer's only customer files. Customer help files (`customer.md`) are written when the customer portal exits its proving window. Unanswerable questions are logged as doc gaps. Depends on the portal identity model and the assistant brief.

**Phase C — in-app `/help` route.** Renders the markdown with the design system, role-filtered, with search over the index. Contractors get `/help` in the contractor portal nav. No PDF export.

**Phase D — voiced video.** Only for day-one contractor flows (offer → pre-start → ticks → variation → walkthrough → self-invoice). Footage from Claude in Chrome; AI voiceover from the help file's step list as script. Built after the WO loop proving window; Tom reviews each once. ⚑ provider not yet chosen — indicative cost is tens of dollars a month; the real cost is Tom's review time, so cap the set at six.

---

## 6. Help file template (`docs/help/_template.md`)

```markdown
---
feature: <slug, matches folder>
role: staff | pc | contractor | customer
title: <what this page helps you do, in plain words>
summary: <one sentence, used in search results and by the assistant>
walkthrough: media/<role>-walkthrough.gif   # optional until A4
verified_at_commit: <set by scripts/help-index.ts>
---

## What this is for
One short paragraph. Who uses it and when.

## Before you start
Anything that must be true first (e.g. "the office has finalised colours").

## Steps
1. Step in the imperative. One action per step.
   ![](media/<role>-01.png)
2. …

## What the colours and labels mean
- **Amber** — waiting on something; the label says what.
- **Cyan** — confirmed / done.
- **Clay** — overdue or needs attention now.
(Only include the states this screen actually uses.)

## If something goes wrong
Two or three most likely problems and what to do. Who to contact and how.

## Related
Links to other help files by feature/role.
```

Rules: no screenshots or text that reveal content outside the file's role; no promises about timing, pricing or policy that aren't already in a shipped Settings value; write in the second person; no Australian idiom in contractor or customer files.

---

## 7. Flagged decisions ⚑

| # | Decision | Blocks |
|---|---|---|
| 1 | Should `pc` be a distinct role in help files, or fold into `staff` until the PC console has a distinct user? (Brief assumes distinct.) | A1 |
| 2 | Is contractor help visible before the contractor has accepted their first offer (i.e. during onboarding), or only after? Affects Phase C nav. | C |
| 3 | Do contractors get notified when a help file changes for a screen they use? (Recommend no for v1.) | C |
| 4 | Day-one contractor flow list for Phase D — confirm the six in §5 or amend. | D |
| 5 | Voiceover provider for Phase D. | D |
| 6 | Should customers ever see a `/help` route, or is assistant-only permanent? (Ruled assistant-only for v1; confirm as permanent or revisit.) | B/C |

---

## 8. Definition of done for this brief

- CLAUDE.md carries the help-file rule; template, README and index script committed and in CI.
- Help files and walkthrough GIFs exist for scheduling, self-invoicing and the WO loop, in every applicable role, all written from e2e runs on the deployed build.
- Tom has read the contractor scheduling file cold and signed it off.
- Session reports list every brief-vs-app discrepancy found.
- Nothing from Phases B–D has been built.
