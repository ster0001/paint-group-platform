# Estimator v2 — progress ledger

**Read this first in every session. Update it last.** One row per chunk from `estimator-v2-delta-and-plan.md`. The row is the truth about what has shipped; the briefs are the truth about what to build. If they disagree, say so in the session before writing code.

## Preflight — paste at the start of every session

    Read docs/briefs/estimator-v2-progress.md. Take the last row whose status
    is not TODO. Then, before touching code, report in one block:
    1. git log --oneline <that row's SHA>..origin/main — what has landed since.
    2. supabase/migrations/ files newer than the row's last migration, and
       whether each has a row in public._prod_migrations (output the SELECT
       for Tom if you cannot read production).
    3. Settings keys the next chunk expects, and which already exist.
    4. Any open branch touching the files the next chunk names.
    5. The next chunk to run, and anything in its block that the repo has
       already done — shrink the block accordingly and say what you removed.
    6. Open design/reference/estimator-journey-v2.html and read every screen
       the chunk names (by id) and its ? drawer. Confirm you are building to
       the prototype, not to an earlier description of it.
    Wait for confirmation before starting the chunk.

## Postflight — the last act of every session

    Add the row: chunk, status DONE / PARTIAL / BLOCKED, date, merge SHA,
    migrations written (and whether Tom has confirmed them live), Settings
    keys seeded, unit count before → after, open ⚑s touched, and one line of
    "what the next session should know". Commit the ledger in the same PR.

## The ledger

| Chunk | What | Status | Date | Merge SHA | Migrations written · live? | Settings seeded | Unit tests before → after | ⚑ touched | Next session should know |
|---|---|---|---|---|---|---|---|---|---|
| — | Baseline: audit at `a1b28fc` | REF | 11 Sep 2026 | `a1b28fc` | production ledger absent | — | 2066 passing | — | 9.1 and 9.2 open; `wizard_drafts` has no version column; `commercial-pricing-strategy.md` untracked |
| C0 | Ledger, stragglers, the missing brief | DONE | 11 Sep 2026 | _(PR pending)_ | `20270135000000_prod_migrations` · **awaits Tom** | — | 2066 → 2076 | A, D, E, G ruled | Backfill INSERT for all 180 files is in the PR body — Tom prunes and pastes it ONCE, then confirms. 15 migrations since 6 Sep still unconfirmed on prod; C1 does not start until they are. Prototype on main was the 9 Sep file — replaced with v2.5, which is the one carrying `s-both`, `sheet-save`, the five `s-com-*` screens and the SEG/BRIEF seeds. Seed scripts still write to production by construction — see the parking lot. |
| C1 | One ladder | DONE | 11 Sep 2026 | _(PR pending)_ | `20270132000000_wizard_policy_v2_keys` (rebased from branch, now self-registers) · **awaits Tom** | `wizard_bands`, `wizard_policy` — NOT `wizard_rewards` | 2076 → 2096 | A(no), D, G | Ruling G applied: the branch shipped bronze/silver/gold + a `wizard_rewards` key (paint upgrade, first pick of start dates, `goldSkipVisit`). All stripped; tiers are now guide/detailed/confirmed. **The tier-chip CSS class IS the tier value** (`ScopeEditor.tsx:661`) — `wizard.css` had to be renamed with it or the chip goes unstyled silently. 9.5 fixed in `policy.ts`: both segment-driven gates (strata, healthcare) join `softForActor`; the four physical gates stay hard. The `softReasons` copy is defensive only — the alias never escaped, and no test can prove it. e2e green on the C1 stack, but `wizard_public.enabled` is FALSE there, so every customer-journey spec fails on the holding page until it is turned on — likely one of the CI-red classes for C17. |
| C2 | `requires_site_check` decided once | DONE | 11 Sep 2026 | _(PR pending)_ | none — but a DATA CORRECTION for proving rows is in the PR body | — | 2096 → 2115 | — | `requiresSiteCheck({state, stored})` in ladder.ts is the only derivation; FOUR callers share it, not the two the block named — `wizard-edit` and `scope-tools` also read the column and would still have disagreed on a pre-C2 row. `effectiveState` not `state` at submit (a failed defect read must not count as a photo). Snapshot gained `requiresSiteCheck`; its ABSENCE marks a row from the affected window. Exterior rows are NOT corrupted — `exterior_signoff` forced walkthrough true either way. Also carries the C1 migration-header fix, which PR #64 merged too early to include. **PROVING ROWS CHECKED ON PROD 11 Sep: 0 needed correction — step 2 was never run.** 6,668 snapshots, 6,481 from the affected window, 0 contradictions. Why: `at_or_above_the_bar = 0` — NOT ONE of 6,668 estimates reached 90% accuracy at submit, so `accuracy_below_bar` forced the walkthrough every time and the wrong flag never changed an outcome. The bug was real and completely masked. 1,340 rows carry `requires_site_check = true` — those are where the fix starts mattering once accuracy can clear the bar. |
| C3 | Draft versioning, one server truth | DONE | 11 Sep 2026 | _(PR pending)_ | `20270136000000_wizard_drafts_version` · **LIVE on prod + C1** | — | 2115 → 2133 | A1b CLOSED | Two-tab e2e GREEN (3 specs, run 4× plus a 7-spec regression batch). It caught TWO bugs reasoning had missed: (1) the localStorage cache is written 400 ms after a keystroke but the server confirms at 2.5 s+, so its version stamp always lagged and `pickResume` wrongly read 'browser is behind' — the cache now re-stamps on confirmation; (2) `decodeResume` rebuilds the record field by field, so `version` and `lastScreen` were silently dropped on the way back in. Also: the resume used to INFER the screen via `entryFromState`, which keys on `state.quickLook` — a key that only exists once the customer ANSWERS a quick-look question, so anyone who typed an address and left came back to the page set. `last_screen` now decides. Invariant: ONE writer of `state`, pinned by a source-reading test. |
| C4 | Outside + Commercial; exterior finish line | DONE | 11 Sep 2026 | _(PR pending)_ | none | — | 2133 → 2147 | — | **Phase 0 complete.** Closes 9.3(a)(b)(c) and 9.4. The commercial hand-off now keys on `quickStep === "place"`, not every Continue. Commercial + outside/both → the `handoff` outcome with `flushDraft` so the lead survives the tab closing; commercial + INSIDE still goes into the page set for the segment question — deliberate. The exterior finish line reuses the SAME `Finish` and `summaryRows` (a second summary would be a second opinion); `SummaryInput.sides` and `finishOptions(kind)` are new. ⚑ C14 REPLACES the 9.3(c) stop-gap with the exterior brief. All four fixes mutation-checked; 16/16 e2e green in a regression batch. |
| C5 | Qualified-lead pack and the queue | TODO | | | `confirmation_requests`; `staff.patch_postcodes` | turnaround copy | | I | |
| C6 | Fix, ask, visit | TODO | | | none | — | | 7 | measured tree written on fix |
| C7 | Self-sign, the hold, the hand-off | TODO | | | none | `hold_days` | | 8, J | |
| C8 | Screen 1, Save & book, "both", email after price | TODO | | | none | `email_gate_position`, `office_phone_display` | | 1, 25, 26 | |
| C9 | What's changing colour, details, What we'll do | TODO | | | `paint_system_rules` only if `deriveSystem` is code-driven | rules rows | | 2, 3, 4, 5 | |
| C10 | Tighten, spots, one missed sheet, site & access | TODO | | | none | — | | 6 | merge `fix/spot-extent-quantity` first |
| C11 | Human moments and the reveal | TODO | | | none | — | | 13 | |
| C12 | Segments as data, office pattern, commercial reveal | TODO | | | `commercial_segments` | 20, 21, 23 | | 19, 20, 21, 23, 32 | |
| C13 | Warehouse pattern | TODO | | | none | 22 | | 22 | |
| C14 | Briefs, booking, commercial exteriors | TODO | | | `commercial_briefs`, `site_checklist_items` | 27 | | 24, 27, 29, 30 | replaces C4 stop-gap |
| GATE | Trade-portal prototype approved | TODO | | | — | — | | 36, 37 | design deliverable, not a session |
| C15 | Building profiles, measured trees, saved specs, spec sheet | TODO | | | `building_profiles`, `properties.measured_tree`, `trade_specs`, `tenant_photo_links` | — | | 11, 12, 34, 35 | |
| C16 | Assistant hooks | TODO | | | none | — | | 14 | |
| C17 | Hardening and the switch | TODO | | | none | — | | A, B, F | CI e2e ≥ every customer-journey spec |

## Rulings recorded (so they are never re-asked)

| Date | Ruling |
|---|---|
| 10 Sep | Glass share not asked; walls at full perimeter, cutting-in offsets |
| 10 Sep | Retail includes hospitality and restaurants |
| 10 Sep | Healthcare asks aged care / clinic / hospital; hospital → brief; counts "resident rooms, wards or treatment rooms" |
| 10 Sep | Every school exterior is a visit; every commercial outside or both is a visit |
| 10 Sep | Every ranged segment tile says "online · or we visit" |
| 10 Sep | No "how we'll paint each surface" screen; "what's changing colour?" tiles; details screen with pictures; What we'll do read-only |
| 10 Sep | The estimator is named and present; one footer human line; inline offers; "Send to <name>" |
| 10 Sep | Removed: per-room condition, asbestos, pets, the hard stop, hospital beds and infection-control rows; hazmat check on the site checklist |
| 11 Sep | Phase 1 is the estimator loop; nobody self-signs before C1 and C2 |
