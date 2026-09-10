# Estimator wizard — state of the repo, 11 September 2026

**What this is.** A description of the estimator wizard **as it exists in the code**, not as any
brief describes it. No v2 brief was read before or during this audit. Every claim carries a
`file:line` citation against one commit, and anything that could not be established from the
repository is marked **unverified** rather than inferred.

| | |
|---|---|
| Commit audited | `a1b28fc` — "Merge pull request #60 from ster0001/fix/tom-batch-10sep", 2026-09-10 22:27 +10:00 |
| Branch | `origin/main` |
| Method | Read-only inspection in an isolated worktree, plus one executed test run (below) |
| Unit suite at this commit | **205 files · 2066 tests · all passing · 4.24 s** (vitest 4.1.10, Node v24.19.0, `TZ=Australia/Melbourne`) |

Five of the findings below were **proved by running code**, not by reading it. A scratch spec was
written against `lib/wizard/policy.ts` and `lib/wizard/quick-look.ts`, executed, and deleted; all
five assertions passed. They are marked **[proved]** where they appear.

---

## 1. Routes and screens under `/estimate`

### 1.1 The route tree

There are five routes. `app/estimate/layout.tsx:1` imports the wizard stylesheet and wraps
everything in the dark `wz` shell, so `/estimate` and `/wizard` are visually one product.

| Route | File | Renders |
|---|---|---|
| `/estimate` | `app/estimate/page.tsx:34` | `WizardApp` in `mode="customer"` (`:243`) |
| `/estimate/scope?id=` | `app/estimate/scope/page.tsx:40` | `ScopeEditor` or `SidesEditor` |
| `/estimate/finish?id=` | `app/estimate/finish/page.tsx:31` | `Finish` — interior only |
| `/estimate/sent?id=` | `app/estimate/sent/page.tsx` | `Sent` — the hand-off screen |
| `/estimate/assist` | `app/estimate/assist/page.tsx:24` | `AssistView` — chat left, live editor right |

The screens themselves are **not** in `app/estimate/`. `/estimate` renders
`app/wizard/WizardApp.tsx` (2,922 lines), which owns every question page and the entire
step machine. `app/estimate/` holds only the route shells and the post-reveal editor.

### 1.2 Two question sets, not one

The wizard contains **two complete and independent question flows**, selected by
`quickActive` at `app/wizard/WizardApp.tsx:374`:

```
const quickActive = isCustomer && entry === "questions" && !quickDone;
```

* **The quick look** — `app/wizard/QuickLook.tsx`, screens driven by `stepsFor()` in
  `lib/wizard/quick-look.ts:360`. This is the default customer route.
* **The page set** — `PageProperty`, `PageSurfaces`, `PageCondition`, `PageDetails`,
  `PagePaint`, `PageExteriorHouse`, `PageExteriorScope`, `PageExteriorCondition`,
  `PageExteriorExtras`, `PageContact`, all inside `WizardApp.tsx`, listed by `pageKeys`
  at `WizardApp.tsx:353-359`. Reached by staff, by the describe and upload routes, and —
  importantly — by **every commercial job**.

### 1.3 Quick-look screen order, per branch

`lib/wizard/quick-look.ts:360-364`:

```
if (jobType === "exterior") return ["start", "place", "outside"];
if (jobType === "both")     return [...QUICK_LOOK_STEPS];   // 5
return ["start", "place", "job", "condition"];              // interior, 4
```

**[proved]** The three branches are 4, 3 and 5 screens.

| Screen | Asks | Source |
|---|---|---|
| `start` | Address, and Inside / Outside / Both | `QuickLook.tsx:60-71` |
| `place` | House / Townhouse / Unit / **Commercial**; bedrooms and storeys | `QuickLook.tsx:74-102` |
| `job` | Scope preset, colour intent | `QuickLook.tsx:104-117` |
| `condition` | Condition band, free-text condition box, occupancy | `QuickLook.tsx:119-140` |
| `outside` | Storeys, substrates, targets, condition, access | `QuickLook.tsx:148-184` |

An **exterior-only** job never walks the `condition` screen; `quick.condition` keeps its
default `"wear"` (`lib/wizard/quick-look.ts:62`). The exterior screen asks its own condition
question instead, so this appears deliberate.

### 1.4 The page-set order, per branch

`WizardApp.tsx:353-359`. Note that every branch keys off **`state.jobType`**, and that
`"both"` falls through to the interior list.

* **Interior (and `both`)** — `property → surfaces → condition → details → contact`
  (customer), or `… → paint` for staff (`:359`).
* **Exterior** — `property → house → [scope] → ext_condition → [extras] → contact` (`:358`).
  `scope` appears only when a target other than the house is ticked. `extras` is dropped for
  commercial.
* **Describe route** — `property → (ext_condition | condition + details) → contact` (`:354`).

Paint questions are never a page of their own for a customer: `PagePaint` is embedded in the
contact page at `WizardApp.tsx:2464`, and in the exterior extras page at `:2852`.

### 1.5 Commercial

Commercial is **not a branch of the quick look**. It is an exit from it.
`WizardApp.tsx:1144-1163`: the moment `quick.propertyKind === "commercial"`, `quickNext()`
sets `quickDone`, forces `entry = "questions"`, resets to page 1 and hands the customer to the
page set. The comment at `:1134-1143` gives the reason — the seven routing gates live on the
property page and a commercial job that reached a price through the quick look would have
skipped all of them.

The segment question and gates render at `WizardApp.tsx:1678-1722`, gated on
`state.customer.propertyKind === "commercial"`. Continue is blocked until a segment is chosen
(`:1081`). The gate logic is `routeCommercial` in `lib/wizard/commercial.ts:141`.

### 1.6 Trade

**Trade is not a route, a screen set, or a branch.** It is a single boolean derived from the
signed-in account at `app/api/wizard/submit/route.ts:128`:

```
const tradeActor = limitAccount?.account_type === "trade";
```

It changes only policy outcomes (§2). The one trade-specific entry point is the saved-spec
seed at `app/estimate/page.tsx:200-221` (`/estimate?spec=…`), which applies a stored answer
set over a **default** state.

---

## 2. `lib/wizard/policy.ts` — the ladder as written

`evaluateGuardrails` (`lib/wizard/policy.ts:216-374`) is the whole ladder. It runs in this
order and returns at the first rung that fires.

### Rung 1 — hard stops (`:234-239`)
`asbestos_suspected` when asbestos is `"yes"`; `lead_paint_disturbance` when
`builtPre1970 === "yes"` **and** `damageTier >= 2`.
→ `outcome: "hard_stop"`, `walkthroughRequired: true`, `canAccept: false`.

### Rung 2 — service area (`:241-251`)
Only when `postcode !== null` (a null postcode means internal mode, and the check is skipped)
and the configured list is non-empty. A blank postcode reads as outside.
→ `outcome: "outside_area"`.

### Rung 3 — human handoffs (`:253-301`)
Reasons are **accumulated**, then filtered:

* Commercial (`:258-279`). If `commercialSegment` is set, `routeCommercial` decides and pushes
  `commercial_gate_<key>` per tripped gate, or `commercial_gates_unanswered`. Otherwise the
  older `commercialKind` answer pushes `commercial_small` / `commercial_large` /
  `commercial_strata`, and an absent answer pushes `commercial_property`.
* `heritage_listed` / `heritage_unsure` (`:280`), `body_corporate` (`:281`),
  `asbestos_unsure` (`:282`).

`softForActor` (`:293-297`) then removes the non-blocking ones. For an ordinary customer that
is `heritage_unsure`, `asbestos_unsure`, `commercial_small`. For a trade actor it additionally
covers `heritage_listed`, `commercial_property`, `commercial_small`, `commercial_large`,
`commercial_strata`, `body_corporate`. Anything left → `outcome: "handoff"`.

### Rung 4 — minimum job (`:303-312`)
A total of `<= 0` is **not** treated as a small job; it returns `handoff` with reason
`nothing_priced` (`:307`). Below `policy.minJobCents` → `below_floor`, and note this is the
only outcome with `walkthroughRequired: false`.

### Rung 5 — reveal (`:314-373`)
Always `outcome: "reveal"`. What varies is `walkthroughRequired`, and `canAccept` is exactly
its inverse (`:372`). `walkthrough` starts as the `requiresSiteCheck` argument (`:321`) and is
forced true by any of:

| Trigger | Line | Reason pushed |
|---|---|---|
| `asbestos_unsure` | `:323` | (already present) |
| `requiresSiteCheck` | `:324` | `site_check_required` |
| `tradeActor` — **every** trade job | `:340-343` | `trade_signoff` |
| `commercial_small` | `:346` | (already present) |
| `jobType === "both"` | `:348-350` | `mixed_scope` |
| any exterior work | `:356-358` | `exterior_signoff` |
| total over cap | `:361-363` | `over_self_serve_cap` |
| accuracy under bar | `:364-366` | `accuracy_below_bar` |

### The five outcomes
`reveal`, `hard_stop`, `outside_area`, `handoff`, `below_floor` (`:200-205`). Customer wording
for the four blocking ones is `GUARDRAIL_MESSAGES` (`:193-198`); the per-reason explanation is
`WHY` (`:381-411`), returned first-match-wins by `guardrailWhy` (`:413-416`).

### The self-serve caps, and where they are read

Declared in `WizardPolicySettings` (`:27-47`) with defaults at `:49-58`:

| Setting | Default |
|---|---|
| `interiorSelfServeCapCents` | 600 000 ($6,000) |
| `interiorSelfServeMinAccuracyPct` | 90 |
| `exteriorSelfServeCapCents` | 1 200 000 ($12,000) |
| `exteriorSelfServeMinAccuracyPct` | 85 |
| `minJobCents` | 200 000 ($2,000) |
| `remoteConfirmCapCents` | 1 200 000 |
| `remoteConfirmInteriorOnly` | `true` |

Read from the `wizard_policy` settings row through `policyFromSettings` (`:72-85`), and applied
once, at `policy.ts:359-360`. Band widths come from a **separate** settings row, `wizard_bands`,
via `bandsFromSettings` (`:87-96`), defaulting to ≥90 → ±4%, 70–89 → ±8%, <70 → ±15% (`:67`).

**The caps are read from two different settings keys in four different places.** Besides
`wizard_policy` above, three sites independently re-derive the same decision from a
`scope_editor` settings row with **hardcoded fallbacks**:

* `lib/wizard/customer-scope.ts:145-156`
* `app/api/estimates/[id]/wizard-edit/route.ts:1448-1455`
* `lib/agent/scope-tools.ts:441-444`

All three use `?? 1_200_000` / `?? 600_000` / `?? 85 : 90`. Changing `wizard_policy` in Settings
therefore does **not** change what the scope editor, the edit route or the assistant will let a
customer accept. See §9.2.

---

## 3. `lib/pricing` — rate item to range

The chain, in execution order. Every step names its file and function.

| # | Step | File · function |
|---|---|---|
| 1 | Coats decided per surface group | `lib/pricing/systems.ts:572` `deriveSystem`, applied at `lib/wizard/merge.ts:225-226` |
| 2 | Substrate → group | `lib/pricing/systems.ts:120` `groupForSubstrate` |
| 3 | Coverage floor (1 coat → 2 on a colour change) | `lib/pricing/systems.ts:563` `enforceCoverage` |
| 4 | Marginal-coat rule, first 100% then 75% each | `lib/pricing/engine.ts:39` `coatMultiplier` |
| 5 | Hours per unit from the rate item | `lib/pricing/engine.ts:52` `hoursPerUnit` |
| 6 | Quantity from geometry | `lib/pricing/estimate.ts:303` `computeQuantity` |
| 7 | Job modifier | `lib/pricing/estimate.ts:274` `jobModifier` |
| 8 | Window-size multiplier | `lib/pricing/estimate.ts:237` `windowSizeMultiplier` |
| 9 | Per-surface uplift % | `lib/pricing/estimate.ts:365` (inline in `priceSurface`) |
| 10 | Prep hours added to painting hours | `lib/pricing/estimate.ts:367` |
| 11 | Charge-out rate | `lib/pricing/estimate.ts:266` `chargeOutCents` |
| 12 | Materials: litres, cost, markup | `lib/pricing/estimate.ts:374-389` |
| 13 | Whole-surface total | `lib/pricing/estimate.ts:333` `priceSurface` |
| 14 | Sundries, size uplift, discount, GST | `lib/pricing/estimate.ts:419` `priceEstimateTotals` |
| 15 | Accuracy score | `lib/wizard/accuracy.ts:94` `accuracyScore`, called at `lib/wizard/view.ts:228` |
| 16 | Band % for that score | `lib/wizard/policy.ts:99` `rangeBandPct` |
| 17 | Total → range | `lib/wizard/policy.ts:107` `rangeFromTotal` |
| 18 | Range assembled for the customer | `lib/wizard/view.ts:124-125` `customerPayload` |

**Multipliers** are three, and they multiply the painting hours only, never prep
(`estimate.ts:366`): `jobMod × sizeMul × uplift`.

**Prep hours** (`prepHr`) are a per-surface field defaulting to 0 (`lib/wizard/starter.ts:247`).
They are written by condition spots (`lib/wizard/spots.ts:197`), exterior allowances
(`lib/wizard/exteriorAnswers.ts:216`), site access (`lib/wizard/site-access.ts:135`), staff
capture (`lib/capture/commit.ts:314,350`) and the assistant (`lib/agent/propose.ts:300`).
Prep is charged at the same charge-out rate as painting but takes **no** multiplier.

**Allowances** are separate from prep. Per-room allowances (colour match, ceilings-only) are
reconciled as real rate-card rows by `lib/wizard/allowances.ts:53` `reconcileRoomAllowances`,
called from `app/api/wizard/submit/route.ts:434`. Exterior access allowances come from the
`exterior_allowances` settings row via `lib/wizard/exterior-allowances.ts` and are applied at
`submit/route.ts:422-427`.

**Order of operations in the totals** (`estimate.ts:464-480`): sundries are added to the
subtotal, then size uplift, then discount is subtracted, then GST is charged on the net. So the
size uplift is inside the discount base and inside GST.

**The range is never a point price.** `rangeFromTotal` rounds outward to whole $10
(`policy.ts:111-112`).

### `lib/pricing/engine.ts` is 80% dead code

`priceEstimate` (`engine.ts:118`) — the function whose first act is to enforce the
"a level of finish must be chosen" non-negotiable (`:119-120`) — is imported by **nothing but
its own test file**. The same is true of `productionHours` (`:78`), `materialLitres` (`:94`)
and `coatMultiplier` (`:39`, referenced only in a comment at `systems.ts:51`). The single live
export is `hoursPerUnit`, used by `lib/pricing/estimate.ts:361`,
`app/quote/capture/CaptureApp.tsx:725` and `lib/estimate/reviewGate.ts:136,141`.

The production path is `priceEstimateTotals` / `priceSurface` in `estimate.ts`, which does not
carry the finish-multiplier guard. This is worth knowing before anyone edits `engine.ts`
expecting it to change a customer's price. CI does still mutation-test it
(`.github/workflows/ci.yml:71-82`), so the marginal-coat rule stays covered.

---

## 4. Session and state

### `wizard_sessions` does not exist

There is **no table called `wizard_sessions`**, and no code references that name. The migration
`supabase/migrations/20270107000000_wizard_sessions.sql` is *named* for it, but its statements
are `alter table public.wizard_drafts …` (`:19`). The table is
**`wizard_drafts`**, created at `supabase/migrations/20261210000000_wizard_drafts.sql:22`.
Eighteen files reference `wizard_drafts`; zero reference `wizard_sessions`.

### Where the state actually lives — three copies

1. **Client, in React** — `const [state, setState] = useState<WizardState>(makeInitialState)`
   at `app/wizard/WizardApp.tsx:195`. This is the live copy. Every answer, including the eight
   quick-look answers, is written here (`:249-252`); the comment at `:207-213` explains that
   holding them in React alone lost them on reload.
2. **Browser, in `localStorage`** — the resume record, read on mount at `WizardApp.tsx:414-436`,
   cleared at `:397`.
3. **Server, in `wizard_drafts.state` (jsonb)** — autosaved through
   `app/api/wizard/draft/route.ts`. On resume the two saved copies are merged, newest wins
   (`WizardApp.tsx:425`).

At submit, a fourth copy is frozen onto the estimate:
`builderState.wizard = { version: 1, state: effectiveState, submittedAt }`
(`app/api/wizard/submit/route.ts:487`).

### The version counter

**There is no version counter.** The `version: 1` above is a literal, written identically on
every submit; it is a schema tag, not a sequence. `wizard_drafts` has **no version column** —
its columns are listed at `20261210000000_wizard_drafts.sql:22-56` and extended at
`20270107000000_wizard_sessions.sql:19-49`, and none of them is a version, etag or lock.

Autosave is therefore **last-write-wins**: `draft/route.ts:176-189` selects the open row by
`user_id`, then updates it unconditionally. The only concurrency protection is the partial
unique index `wizard_drafts_user_key` (one open draft per user,
`20261210000000_wizard_drafts.sql:60-61`) and a ten-minute "just finished" grace window
(`draft/route.ts:198-206`) that stops a trailing autosave resurrecting a converted draft.

### The assisted-session path

`/estimate/assist?c=<conversation>` or `?estimate=<id>` (`app/estimate/assist/page.tsx:24`).
All server work is in `openAssistSession` (`lib/agent/session.ts`); the page renders chat and
the live confirm-loop editor side by side, both writing the same tree
(`app/estimate/assist/page.tsx:10-15`). The assistant does **not** ask the commercial segment
question — `lib/wizard/policy.ts:264-267` records this explicitly and falls back to
`commercialKind`. `AssistantWidget` is also mounted on the scope editor
(`app/estimate/scope/page.tsx:6`).

---

## 5. Migrations applied in production — **unverified**

**The repository contains no reliable record of which migrations are live in production, and
this audit does not claim one.**

`supabase/migrations/` holds **180 `.sql` files**. The 12 most recent by filename:

| Filename | What it does |
|---|---|
| `20270134000000_staff_notifications.sql` | Which staff member is told what, by email or text (10 Sep) |
| `20270133000000_occupancy_modifiers.sql` | Occupancy modifiers `STG-EMPTY` etc., ~2%/4% of job value |
| `20270131000000_staff_gcal_scopes.sql` | Staff Google connections remember granted scopes |
| `20270130000000_agent_tone_kb.sql` | Data-only update to `agent_settings.tone` |
| `20270129000000_crm_batch_7sep.sql` | `accounts.notify_prefs` plus consent provenance |
| `20270128000000_cement_sheet_rate.sql` | Cement Sheet exterior substrate, cloned from Render |
| `20270127000000_crm_visits.sql` | `visits` table with a double-booking exclusion constraint |
| `20270126000000_crm_campaigns_v2.sql` | Campaigns with rules; audience-fact columns |
| `20270125000000_crm_status_model.sql` | Relationship state, contact permissions, tags |
| `20270124000000_crm_messages.sql` | `messages` — one table per conversation |
| `20270123000000_crm_record_writes.sql` | The customer record becomes writable |
| `20270122000000_crm_account_facts.sql` | `crm_account_facts` facts layer |

### Why production state cannot be established from the repo

* `CLAUDE.md:51` states the governing convention: migrations are committed "even though **Tom
  pastes SQL manually**". There is no automated production apply.
* No `supabase/config.toml`, no `.supabase/`, no `supabase` CLI dependency in `package.json`,
  and no committed `schema_migrations` dump. Standard Supabase linkage is absent.
* The only migration ledger in the codebase, `_c1_migrations`
  (`scripts/c1/apply-migrations.mjs:66`), tracks the **test** project by construction — the
  runner calls `refuseProduction(url)` (`:32`) and reads `.env.test.local`, never `.env.local`.
* `docs/SESSION-HANDOFF.md` is the de-facto queue, using the words QUEUED / AWAITS TOM ON PROD /
  RUN LIVE in dated headings (e.g. `:1`, `:196`, `:289`, `:813`). **It is stale**: its newest
  entry is 6 Sep, and every migration from `20270111` onward — 15 of the 25 most recent — has
  no entry at all. `docs/briefs/tom-batch-10sep-handover.md:79` says `20270134` is "queued for
  production" and nothing records the outcome.
* Drift is documented in **both** directions. `docs/testing/c1-test-project.md:90` records that
  migration `20260924` "was run on production then withdrawn from the repo", and `:92` that
  production carries pre-invoicing rows the migrations do not recreate. File presence is
  provably not equivalent to production application.

### Numbering anomalies

* Seven duplicate numeric prefixes exist, including two distinct files both numbered
  `20270110000000`. Ordering falls back to alphabetical filename
  (`scripts/c1/apply-migrations.mjs:61` sorts with a plain `.sort()`), not to intent.
* Main has gaps at **20270112, 20270113, 20270115–20270119, 20270132**. Of these, `20270112`
  lives on `origin/fix/qa-recheck` and `20270132` on `origin/feat/one-ladder` (§7).
  **20270113 and 20270115–20270119 exist on no branch in this repository.**

### The honest statement

Any claim that a specific migration is live must come from Tom or from a live
`information_schema` read. It cannot come from this repository.

---

## 6. Tests

### Totals at this commit

| | Count |
|---|---|
| Unit test files (vitest) | **205**, all under `lib/`, all `.ts` |
| Unit tests executed | **2066 — all passing** |
| E2E spec files (Playwright) | **156** |
| E2E `test(` calls | **516** |
| E2E specs CI actually runs | **38 of 156 (24%)**, covering 93 of 516 calls (18%) |

`vitest.config.mts:11` includes only `lib/**/*.test.ts`. A test written under `app/` or as
`.tsx` would silently not run. Nothing is affected today.

### E2E

`playwright.config.ts:24` sets `testDir: "./e2e"`; `:39` configures **chromium only**;
`:30-31` set `retries: 0` and `workers: 1`. E2E is opt-in at the script level — `npm test` is
vitest, `npm run test:e2e` is Playwright (`package.json:10,12`), and the config comment at
`:8-9` says so deliberately. `e2e/global-setup.ts:53-60` throws if the target Supabase URL is
the production project.

There are **309 `test.skip(...)` calls across the 156 specs** — conditional skips on missing
credentials. `e2e/global-setup.ts:16` records the earlier audit count as 160 across 74 files,
so the conditional-skip surface has roughly doubled.

Wizard/estimate specs: all 34 in `e2e/customer-journey/`, plus `wizard-buckets`,
`staff-wizard-new-editor`, `perf-wizard-editor`, `paint-systems`, `colour-split-golden`,
`condition-hours-golden`, `desk-check` and the estimate-list specs — 43 by filename.

### Pricing coverage

**21 files, 237 cases.** Six inside `lib/pricing/` (`engine` 12, `estimate` 28, `golden` 3,
`sizeUplift` 3, `systems` 46, `windowsize` 6) and 15 elsewhere that import pricing code —
notably `lib/wizard/sides.test.ts` (21), `lib/wizard/systems-view.test.ts` (26),
`lib/capture/commit.test.ts` (19) and `lib/agent/propose.test.ts` (13).

`lib/pricing/context.ts` has **no dedicated test file**; it is exercised only indirectly via
`lib/agent/scope-tools.test.ts:25`.

Two guards are worth naming. `lib/workorder/boundary.test.ts:80` asserts that no module "does
hours × rate arithmetic outside lib/pricing" — an architectural test of CLAUDE.md's own rule.
And `.github/workflows/ci.yml:71-82` is a **mutation canary**: it rewrites the marginal-coat
rule from `0.75` to `0.70`, reruns `lib/pricing`, and fails the build if the suite still
passes.

### The last failing run — **unverified**

The `gh` CLI is not installed on this machine (`which gh` → not found; absent from `PATH`,
`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `~/.local/bin` and `node_modules/.bin`).
GitHub Actions run history could not be read, so **the most recent failing CI run — its
workflow, branch, date and title — is unverified.** It is not guessed here.

What *is* verified: the full unit suite passes at `a1b28fc`. And no document in the repo
records the suite as currently red. The failures `docs/` does record are all written up as
found-and-fixed:

* `docs/SESSION-HANDOFF.md:474-476` — `e2e/wo-photos.spec.ts:121` asserted `href` on a tile that
  became a button on 22 Aug; failing silently for about five days. Fixed.
* `docs/audits/audit-2026-08-full.md:2398-2418` — the first confirmed flake,
  `lib/gcal/gcal.test.ts`, measured at 3 failures in 20 runs before the fix, 0 in 30 after.
* `docs/SESSION-HANDOFF.md:1569-1571` — `customer-journey/sides-editor` "amber to cyan" failed
  2 runs in 3, now 4/4.

Two tests are recorded as deliberately **not yet written**, both about the same bug:
`docs/SESSION-HANDOFF.md:1420-1422` and `:1312-1313` (a contractor booked twice on one day).

---

## 7. Open branches with unmerged wizard work

81 remote branches; **72 fully merged into `origin/main`, 9 unmerged**. Verified by ancestry,
cross-checked with `git cherry` (every commit returned `+`) and by file presence on main, so
none is a squash-merge false positive. Three of the nine form a single stack, so the real count
is **7 distinct lines of work**.

### Wizard, estimator or pricing (6)

**`fix/tom-batch-10sep`** — `43da573`, 10 Sep 22:57, 1 ahead / 3 behind.
"Dark to light: the tick earns the coat, and exterior sizing is asked not assumed."
Touches `lib/pricing/systems.ts`, `lib/wizard/customer-scope.ts`, `app/estimate/scope/*` and
three e2e specs. **This is a post-merge straggler** — main's own tip is the merge of PR #60 from
this branch at 22:27, and the branch took one more commit at 22:57. No migration.

**`fix/spot-extent-quantity`** — `182823c`, 9 Sep, 2 ahead / 32 behind.
"Spot extent is a QUANTITY, not a severity" plus "'Most of it' is a routing decision, not a
bigger number". 12 files across `lib/wizard/spots.ts`, `accuracy.ts`, `photo-defects.ts`,
`view.ts` and the room-spots UI. No migration.

**`feat/one-ladder`** — `b7c8ffe`, 8 Sep, 1 ahead / 51 behind.
"One function decides tier, self-serve and the next unlock; the three copies and the duplicate
settings go." Adds `lib/wizard/ladder.ts` + tests, `app/(app)/settings/TiersSettings.tsx`, and
**migration `20270132000000_wizard_policy_v2_keys.sql`**. This branch is the fix for the
duplicated self-serve caps described in §2 and §9.2.

**`feat/proving-exclude`** — `70c1376`, 9 Sep, 1 ahead / 51 behind.
"Proving window: set aside the rows that aren't a fair test." Touches `lib/wizard/proving.ts`
and the `/proving` dashboard. No migration.

**`docs/reward-tiers-plan`** — `31ee7d8`, 8 Sep, 3 ahead / 51 behind.
Docs and mockups only, 650 lines all additions: `docs/briefs/customer-flow-plan.md`,
`docs/briefs/reward-tiers-plan.md`, and two v3 mockups under `design/reference/`. No code.

**`fix/f1-02-seed-wizard`** — `5dc213f`, 28 Aug, 10 ahead / **262 behind**. A money-formatter,
CI and rate-card-seed sweep; its wizard touch is incidental (`CustomerResult.tsx`, `Editor.tsx`).
Heavily stale.

### Not wizard work (3)

* **`fix/a2-02-ratecard-transaction`** — `2a2a4ab`, 28 Aug, 13 ahead / 262 behind. Settings save
  in one transaction. Adds migration `20261203000000_settings_rows_save_rpc.sql`.
* **`fix/ci-secret-names`** — `53b5451`, 28 Aug, 2 ahead / 262 behind. CI secret names.
* **`fix/qa-recheck`** — `e408774`, 6 Sep, 1 ahead / 129 behind. Work-order QA re-check. Adds
  migration `20270112000000_wo_qa_recheck.sql`.

`fix/ci-secret-names` ⊂ `fix/f1-02-seed-wizard` ⊂ `fix/a2-02-ratecard-transaction` — one stack.
Those three are 262 commits behind main and will not rebase cleanly.

**Open pull requests: unverified** — the `gh` CLI is not installed.

---

## 8. Where the code contradicts `CLAUDE.md`

### 8.1 A referenced brief that does not exist — `CLAUDE.md:48`

> "A referenced file that doesn't exist is a stop-and-report, never a build-around."

`lib/wizard/commercial.ts:3` cites `docs/briefs/commercial-pricing-strategy.md` as the governing
document for the segment question and the seven routing gates. `docs/ARCHITECTURE.md:2852` cites
it too. **The file is not in the repository.** It is the only missing reference among all briefs
cited by `app/wizard`, `app/estimate`, `lib/wizard` and `lib/pricing` — every other one resolves.

The commercial gating was built anyway. The rule says that should have stopped and been reported.
The file does exist as an **untracked** file in the `paint-group-platform` working directory, so
the fix is likely just to commit it.

### 8.2 Pricing and policy thresholds computed outside the one module — `CLAUDE.md:5`

> "Estimate pricing math lives in ONE module (`lib/pricing/`). No component, route or script
> computes prices independently."

The pricing *math* rule is honoured, and there is even a test enforcing it
(`lib/workorder/boundary.test.ts:80`). But the self-serve **decision** is computed independently
in four places from two different settings keys, with hardcoded money constants in three of them
(§2). `lib/wizard/policy.ts` is also where customer-facing range money is calculated
(`rangeFromTotal`, `:107`) — that is in `lib/wizard/`, not `lib/pricing/`.

This is the single-source violation the rule is aimed at, even if the literal words say "math".
`feat/one-ladder` exists to fix it and is unmerged.

### 8.3 Silent catch blocks — `CLAUDE.md:27`, minor

> "No silent catch blocks."

Six catch blocks in the wizard surface have a comment as their entire body:
`app/wizard/ChatWidget.tsx:49` and `:63`, `app/wizard/WizardApp.tsx:397`, `:402` and `:976`,
and `app/estimate/assist/useLiveConversation.ts:32`. Five of the six guard browser storage,
which genuinely throws in private-browsing and blocked-storage contexts; the sixth is a poll
that retries on the next event. Each carries an explaining comment. This reads as a defensible
narrow exception rather than a real violation, but it is a literal contradiction and is
recorded so Tom can rule on it.

### 8.4 What is NOT violated

Worth stating, since audits tend to list only failures:

* **The `any` ban (`CLAUDE.md:23`) is fully respected** across `app/wizard`, `app/estimate`,
  `lib/wizard` and `lib/pricing`. A grep for `: any` / `as any` returns two hits, both the
  English word "any" inside prose comments.
* Money is integer cents throughout the chain in §3.
* Every API route in the wizard validates with zod before touching the database, and totals are
  recomputed server-side at `submit/route.ts:491` rather than trusted from the client.

---

## 9. Defects visible in the code

Ordered by consequence.

### 9.1 The submit route and the scope page disagree about `requires_site_check` — **[proved]**

`evaluateGuardrails`' fourth parameter is `requiresSiteCheck` (`lib/wizard/policy.ts:220`), and
the module docstring at `:19` states acceptance is "Never for a job carrying
requires_site_check".

Two callers pass **different values**:

* `app/api/wizard/submit/route.ts:501` passes **`wantsExterior`**, which is just
  `state.jobType !== "interior"` (`:367`).
* `lib/wizard/customer-scope.ts:120` passes the **real** `estimates.requires_site_check`.

Meanwhile the same submit route writes `requires_site_check: true` for a much wider set of
conditions (`submit/route.ts:744-757`), including — for an **interior** job —
`conditionPhotoCount(effectiveState) > 0`. The comment immediately above at `:741-743` states
the intent plainly: "condition photos = estimator sign-off before any price is fixed, interior or
exterior — the customer … cannot accept online until a person has looked."

So an interior job with condition photos is marked `requires_site_check` in the database while
`evaluateGuardrails` at submit was told `false`. Executed proof:

| Call | `requiresSiteCheck` arg | `canAccept` |
|---|---|---|
| Submit route's value for an interior job | `false` | **`true`** |
| Scope page's value for the same estimate | `true` | `false` |

The stored proving snapshot (`submit/route.ts:512-522`) records the wrong
`walkthroughRequired` too, which quietly corrupts the proving-window baseline. The scope page
re-decides correctly, so this is most dangerous in the submit response and the snapshot rather
than at the accept button — but the two should not be able to disagree at all.

### 9.2 Self-serve caps are read from two settings keys in four places

Detailed in §2. A cap edited in Settings under `wizard_policy` changes rung 5 of the ladder but
**not** the scope editor (`customer-scope.ts:153`), the edit route
(`wizard-edit/route.ts:1452`) or the assistant (`scope-tools.ts:443`), which read
`scope_editor` with their own hardcoded fallbacks. Fixed on the unmerged `feat/one-ladder`.

### 9.3 Outside + Commercial, on screen 1

Three separate faults meet on the first screen.

**(a) A business visitor never sees the quick look.** `app/estimate/page.tsx:43` parses
`?mode=business` into `intent.propertyKind = "commercial"`
(`lib/marketing/prefill.ts:56`). That seeds *both* the quick-look answers
(`WizardApp.tsx:216`) and `state.customer.propertyKind` (`:181`) before the first render. The
commercial hand-off at `WizardApp.tsx:1144` is checked on **every** `quickNext()` call, before
the "are we on the last screen?" test at `:1164`. So the very first Continue on screen 1 exits
the quick look. The visitor is promised four screens and gets one. No guard ties the hand-off
to the `place` step.

**(b) The screen-1 promise is wrong on two of three branches.** `QuickLook.tsx:65` reads "Four
quick screens, then a guide range." **[proved]** `stepsFor` returns 3 screens for Outside and 5
for Both (`lib/wizard/quick-look.ts:361-363`). Pick "Outside" on screen 1 and the copy is
already false; the dots below it (`WizardApp.tsx:1239`) correctly show three, so the screen
contradicts itself.

**(c) Outside + Commercial then lands on house questions.** After the hand-off,
`pageKeys` for `state.jobType === "exterior"` is
`property → house → [scope] → ext_condition → contact` (`WizardApp.tsx:358`; `extras` is dropped
because `commercial` is true at `:352`). The `house` page is `PageExteriorHouse`, headed "What
we're painting" with house / fence / deck / shed targets and domestic storeys
(`WizardApp.tsx:2469-2554`). An office, warehouse or shopfront exterior is being asked which
weatherboards it has.

**This combination is not covered by any test.** `e2e/customer-journey/commercial-kind.spec.ts`
never touches the job-type chips — it takes the default (interior) and goes straight to
`ql-kind-commercial` (`:45`). No spec exercises Outside plus Commercial.

### 9.4 An exterior-only job has no finish line

`app/estimate/finish/page.tsx:49-54`: when the loaded bundle is not `"rooms"`, the page returns
a holding message, "Open your estimate to finish it off." The comment states it outright — "An
exterior-only job's finish line is its own screen (§3's branch) and **is not built**". Screen 10
therefore dead-ends for every exterior-only customer.

### 9.5 Trade relaxation is inconsistent between the two commercial routes — **[proved]**

`softForActor` (`lib/wizard/policy.ts:293-297`) makes `commercial_strata` and `commercial_large`
soft for a trade actor, but the reasons the **segment** route emits are named
`commercial_gate_strata` and `commercial_gate_healthcare` (`:272`) and are **not** in the set.
Same trade customer, same strata building, opposite outcome depending only on which question
they were asked:

| Answer path | Trade outcome |
|---|---|
| `commercialKind: "strata"` (older sessions, the assistant) | **`reveal`** |
| `commercialSegment: "strata"` (the current question) | **`handoff`** |

Since the segment question replaced `commercialKind` for anyone answering now
(`WizardApp.tsx:1681-1686`), the effective behaviour for a trade actor changed without the
relaxation list being updated.

### 9.6 `softReasons` is an alias, not a copy

`lib/wizard/policy.ts:320`: `const softReasons = reasons;`. The two names refer to the same
array, so every `softReasons.push(...)` at `:324`, `:342`, `:349`, `:357`, `:362`, `:365` also
mutates `reasons`, which is still being read at `:346`. No live bug — the reads happen to
precede the writes that would matter — but the naming states the opposite of what the code does,
and the next reason inserted in the wrong place will be a real one.

### 9.7 Stale artefacts

* **`groupForSubstrate`'s docstring contradicts its body.** `lib/pricing/systems.ts:112-114`
  says "Exterior surfaces fall through to the existing whole-job coats until that spec lands",
  while `:143-148` returns `"exterior"` for eighteen substrates. The 9 Sep note at `:128-142`
  superseded the earlier paragraph but the earlier paragraph was left in place.
* **`pages_total` defaults to 6.** `20270107000000_wizard_sessions.sql:32`. The quick look has
  3, 4 or 5. Overwritten on the first autosave that sends `lastPage`
  (`draft/route.ts:172`), so it only shows on a draft that never saved a page.
* **`app/estimate/page.tsx:31`** still carries `robots: { index: false, follow: false }` with
  the comment "flipped at Step 10". Correct while the public gate is shut; a launch checklist
  item, not a bug.

### 9.8 Not defects, recorded to prevent re-investigation

* The `entry` initialiser at `WizardApp.tsx:337-341` looks inverted — it yields `null` when a
  resumable route *is* detected. The mount effect at `:429` sets the correct value immediately
  afterwards, so a resumed quick look does return to the quick look.
* `state.customer` is never null in customer mode (`WizardApp.tsx:176`), so the
  `s.customer ? … : s.customer` ternary at `:1147` cannot silently drop the commercial answer.
* An exterior customer does get the paint questions: `PagePaint` is embedded in the contact page
  (`:2464`).

---

## 10. What could not be verified

Recorded explicitly so no reader mistakes silence for confirmation.

1. **Which migrations are applied in production.** No production ledger exists in the repo; the
   only ledger is test-only by construction, and drift in both directions is documented. §5.
2. **Whether migrations `20270111`–`20270134` have been pasted on prod.**
   `docs/SESSION-HANDOFF.md` stops at 6 Sep.
3. **Whether production carries migrations never committed here.** Precedent exists
   (`20260924`, per `docs/testing/c1-test-project.md:90`), so the folder is not a closed set.
4. **The last failing CI run.** `gh` is not installed on this machine. §6.
5. **Open pull requests.** Same reason. §7.
6. **Whether the `gate` and `e2e` jobs are marked required in GitHub branch protection.**
   `.github/workflows/ci.yml:7-8` states the intent; the setting itself lives in GitHub.
7. **Runtime behaviour of the screens.** §1 and §9.3 are established by reading the code and by
   executing `lib/wizard` directly. The wizard was **not** driven in a browser for this audit —
   `wizard_public` gates the public route (`app/estimate/page.tsx:126`) and no dev stack was
   started. The five **[proved]** findings are the ones backed by execution; the rest are
   backed by code with citations.
