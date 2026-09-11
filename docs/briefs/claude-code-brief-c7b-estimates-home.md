# Chunk C7b — The estimates page becomes the home of estimating

**Slots into:** `docs/briefs/estimator-v2-runsheet.md` §5, between C7 and C8. Run it after C7 is `DONE` in the ledger, before C8.
**Size:** M (about a day). **Migration:** none expected — confirm in step 1.
**Approved design:** `design/reference/estimates-home-mockup.html` — open it, click the Pack and Scope editor links, the checkboxes and the tabs. It is the target for layout, copy and behaviour. Where this brief and the mockup disagree on behaviour, this brief wins; on look and copy, the mockup wins; report either way.

---

## Why this chunk exists

C5 and C6 built the estimator loop against a brief that specified "a queue and a pack view in the estimator console". That brief was written without sight of the live estimates page, and it breaks a standing rule: **one work-queue evaluator (`lib/crm/work-queue.ts`), and no module builds its own list or badge.** A confirmation waiting on an estimator is an attention item like any other.

It also duplicated a screen. The live estimates page already carries the tabs, bulk select, Capture, Delete, pagination, a **Wizard** tab and a **Wizard status** column. The pack is a reading view of an estimate that already has an editor — not a second place to look.

So: fold the queue into the estimates page, make the pack a tab on the estimate, and change nothing else about either.

---

## Step 1 — Report before you build (no code)

    Report with file:line, and wait:
    1. What C5 actually built. Is the confirmation queue a separate route and
       component, or a view over an existing list? Does it derive from
       lib/crm/work-queue.ts, or does it build its own list?
    2. Is the C5 pack a separate screen, a route, or a tab on the estimate?
       Does it read the same estimate record the editor writes, or a copy?
    3. The live estimates page: its route, component, the query behind the
       tabs, the shape of the Wizard status column and where its pill text
       and mono sub-line come from, and how Capture / Delete / bulk select
       are wired.
    4. Whether "waiting on you" can be expressed as a trigger in
       lib/crm/work-queue.ts without changing that evaluator's contract.
    5. Anything in C5/C6 that other code now depends on (the console, CRM
       Today, notifications), so we know what a fold-back would break.
    Then propose the smallest change that reaches the target, and wait.

If C5 already built it as a tab over the same record, say so — this chunk shrinks to the list changes and the fold-back is unnecessary.

---

## Step 2 — The estimates page

Target: `design/reference/estimates-home-mockup.html`, list screen.

**Keep exactly as-is:** every existing tab (All, Draft, Sent, Viewed, Accepted, Declined, Expired, Wizard) with its current query; bulk select and its actions; Capture; Delete, including the disabled state on rows where it doesn't apply; pagination; search; the "Customer editor →" link; the light theme and the existing type and colour scale. **Do not restyle the page.**

**Add, and nothing more:**

1. **A "Waiting on you" tab, first and default.** Its rows come from `lib/crm/work-queue.ts` — the same evaluator CRM Today reads. **Do not write a second query, a second badge or a second count.** If the evaluator needs a new trigger for confirmations, add the trigger there; the tab reads what comes back. Row tint per the mockup.

2. **Wizard status pill vocabulary extended.** The column keeps its shape — pill plus mono sub-line. Existing states stay. Add: `Sent · confirm remotely`, `Sent · needs a visit`, `Question unanswered · {n}d`, `Brief · book a visit`, `Viewed {n}× · no reply`, `Abandoned · room {n} of {m}`, `Accepted {date} · job created`. Every state is **derived** from the estimate, its `confirmation_requests` row and the accuracy evaluator — no stored status string. The sub-line carries what the estimator needs: `9 of 9 · ±4% · 7 photos · 41m ago`.

3. **One contextual action per row**, immediately before Capture, from the same suggested-action rules C5 built: Fix price · Book · Chase · Nudge · Open job. One only. If the rules produce nothing, render nothing.

4. **A `Pack →` link** in the links row under the title, beside `Customer editor →`, **only when the estimate has wizard data**. Rows without it (in-house, assistant drafts) must not show it — assert this in a test.

5. **A source filter** — All / From customers / Built in-house — as a segmented control with the other filters.

6. **Value shows a range** while the estimate is a range (`$9,320–$10,940` with `range` underneath), and a single figure with cents once fixed. Money formatting from the existing helper; no client arithmetic.

---

## Step 3 — The estimate: Pack as a tab

Target: the mockup's estimate screen, both tabs.

1. **The strip** sits under the header, above the tabs, on every tab: `9 of 9 rooms confirmed · ±4% · 7 photos · 1 repair to price · under the $12k cap` then the suggested action and its three buttons (Fix the price and send · Ask a question · Book a visit). All figures derived; the buttons call the C6 RPCs unchanged. Where C7's fix-online applies, that button appears per the ladder — never client-side.

2. **A `Pack` tab**, first, badged *wizard*, **present only when the estimate has wizard data**. It renders: areas with green/amber provenance, photos pinned to areas, "What we'll do" from the derivation, site and access, and the right column (range with band and the $/m² check, how they got here from `wizard_events`, customer history). Everything is a **read** of the same estimate — no copy, no second store. Links inside it that change anything jump to Scope.

3. **The Scope tab is the existing editor, untouched**, with one addition: a coloured left edge on each area — green where the customer confirmed it, amber where the assumption stands. Do not restructure the editor, do not change its rows, do not re-implement it from the mockup. The mockup's Scope pane is an illustration of the colour only.

4. **Delete the C5 pack screen and queue route** if step 1 found them, along with any links into them.

---

## Acceptance

- The confirmation queue is gone as a separate route; `grep` finds one work-queue evaluator and no second list, count or badge for confirmations.
- CRM Today and the "Waiting on you" tab show the same estimates, proved by a test that adds a confirmation and asserts both.
- Every existing estimates-page function still works: tabs, bulk select and its actions, Capture, Delete with its disabled state, pagination, search, Customer editor. Regression test per function.
- `Pack →` appears on wizard estimates and on no others; an in-house estimate opens on Scope with no Pack tab.
- The pack and the editor read and write the same estimate record — a change in Scope shows in Pack without a refresh path of its own.
- No wizard-status string is stored; each is derived, with a table test covering all states.
- The strip's figures come from the accuracy evaluator and the tree, never from the client.
- Unit count reported before and after; visual check against the mockup on desktop at 1440px.

**Tom's check:** open Estimates — it lands on "Waiting on you" with the right rows; select two, the bulk bar appears and Clear works; open 14 Acacia from the Pack link and it lands on the Pack tab; switch to Scope and it's the editor you use today with green and amber edges; open an in-house estimate and there's no Pack tab at all.

---

## ⚑ Decisions

| # | Decision | Default unless you say otherwise |
|---|---|---|
| 38 | "Waiting on you" as the default tab, or All? | Waiting on you |
| 39 | Contextual action: one per row, or a menu? | One; nothing if the rules produce nothing |
| 40 | Pack tab first or after Scope? | First on wizard estimates; absent otherwise |
| 41 | Does the strip show on every tab, or only Pack? | Every tab — it's about the estimate, not the view |
| 42 | Should "Priced · no request" rows appear in Waiting on you? | No — they're a chase list, not a decision. Keep them in Wizard and add a chase trigger to the evaluator later |

---

## Reference files

    design/reference/estimates-home-mockup.html      (this chunk's target — commit it)
    docs/briefs/estimator-v2-delta-and-plan.md       (§2.6 — the qualified lead, the suggested-action rules)
    docs/briefs/estimator-v2-runsheet.md             (the loop this chunk runs inside)
    lib/crm/work-queue.ts                            (the one evaluator — read it before step 2)
    CLAUDE.md                                        (one source of truth per list and badge)

Ledger row on completion, as always, and note in it whether the C5 fold-back was needed.
