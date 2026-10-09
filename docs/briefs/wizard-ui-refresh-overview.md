# Wizard UI refresh — start here

**For Tom.** One page on what is in this pack, how to start, and what you do along the way.

## What you are getting

The estimator wizard keeps every question, price and rule it has today. What changes is how it looks and feels:

- A proper two-column layout on a laptop, instead of a phone column stretched across the screen.
- A live picture beside the questions that responds to each answer: the house, a room, the floor plan, the house from above, a warehouse.
- A range that visibly narrows as the customer checks rooms or sides.
- One slim header, one main button per screen, larger text and tap targets, no shouting capitals.
- The same treatment on every path: home inside, home outside, home both, all eight commercial types, and the screens around them (pop-ups, "sent", "booked").

Nothing goes live to the public from this work. The public switch (Settings → Estimates → Online estimates) stays yours to flip.

## What is in the pack

| File | What it is | Who reads it |
|---|---|---|
| `wizard-ui-refresh-overview.md` | This page. | You |
| `wizard-ui-refresh-runsheet.md` | **The build plan.** Ten sessions, each with what to build, the tests to pass, and what you check on your phone. Paste it into Claude Code to start. | Claude Code, you |
| `wizard-ui-refresh-decisions.md` | Your decisions, with a default for each so nothing waits on you. | You, Claude Code |
| `claude-code-brief-wizard-ui-refresh.md` | The full brief: every screen, the rules, the acceptance checks. | Claude Code |
| `wizard-ui-refresh-components.md` | Design documentation: colours, type, each component, each picture, motion, and where every old piece moved. | Claude Code, anyone maintaining it later |
| `wizard-ui-refresh-test-hooks.md` | The 78 class names and 551 test ids your existing tests rely on, and the rules the new layout must keep. | Claude Code |
| `wizard-ui-refresh-progress.md` | The ledger. One row per session, filled in as each one ships. | Claude Code, you |
| `estimator-wizard-redesign-mockup.html` | The mockup, all six job types. | Everyone |

In the zip they sit in the folders they belong in (`docs/briefs/` and `design/reference/`), so you can unzip it into the repo root.

## How to start

1. Unzip the pack into the repo root.
2. Open a new Claude Code chat in its own worktree and paste the whole of `wizard-ui-refresh-runsheet.md`.
3. It will check the files, commit them, take "before" screenshots and stop. Open the mockup on your phone, tap through all six job types, and reply "mockup approved" or list changes.

From then on each chat is two lines from you: the "continue" line in the run sheet's §7, then `Go: S1` (then S2, and so on).

## The ten sessions

| # | What ships | What you check on your phone |
|---|---|---|
| S0 | The pack is committed; "before" screenshots taken | The mockup, all six job types |
| S1 | New header, layout and controls on every step of every path | Two columns on a laptop, one tidy column on the phone |
| S2 | The live picture and "Your job so far" for home inside | Untick Ceilings; watch the ceiling change |
| S3 | The range screen on every path | Price first, one obvious button |
| S4 | Room by room, and area by area for commercial | The range narrows; nothing empty on the right |
| S5 | Home outside, including side by side | The house paints as you tick; wall shares add to 100% |
| S6 | Home both | Rooms and sides on one page; the three ranges add up |
| S7 | All commercial types | Office, warehouse, strata, hospital, a commercial outside |
| S8 | Pop-ups, chat, "sent", "booked", holding page | Panels slide in; never a full-page takeover |
| S9 | Finalise and visit screens, clean-up, help pages | One whole job of each type, phone and laptop |

The order matters: S1 puts the new frame on everything at once, so no path is left looking old while the others move ahead. At roughly one session a day this reaches S9 in about two working weeks, which leaves the third week of your launch window for fixes. That pace is an estimate, not a promise; your phone checks are the usual limit.

## Your part

- **Each session:** approve the diff, walk the preview on your phone against the one line marked *Tom's check*, say yes or list what is off.
- **Decisions:** six need your ruling at some point (colour swatches, "a job like yours" card, trust wording, the commercial versions of those, who is named on commercial jobs, chat in the header). Each has a default that ships safely without you. Three scope calls default to "not now": the trade lane in the portal, staff mode, and the assistant page.
- **No SQL.** This plan has no database changes.

## Three things to know

1. **"Both" jobs stay stacked.** Your earlier ruling was rooms first, then sides, on one page with one count and one pair of buttons. I had drawn an Inside / Outside switch that hid one half; the mockup and brief now follow your ruling, with the two chips as jump links.
2. **Your tests constrain the layout, and the plan respects them.** For example, one test checks the range and progress stay on screen at any scroll position; they do, in the right-hand rail on a laptop and a slim strip on the phone.
3. **Still open from the first review:** the repo is public on GitHub, and the live editor shows an "Imported · Custom surface · $105" chip to customers. Neither is part of this plan.

## How this fits the platform

The wizard is the front door. A finished or abandoned estimate becomes a lead in the CRM; a range becomes a site visit through the visit calendar; a confirmed price becomes the estimate, then the work order, the customer portal and the invoice. This refresh changes none of those hand-offs. It is aimed at one number: how many people who start the wizard reach a range and then take a next step.
