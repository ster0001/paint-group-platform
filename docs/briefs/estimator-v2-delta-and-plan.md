# Estimator v2 — the delta, the six questions, and the plan in chunks

**Prepared:** 11 September 2026, against `wizard-audit-2026-09-11.md` (commit `a1b28fc`)
**Status:** the operating plan. Each chunk below is one Claude Code (Opus) session: one concern, one gate run, migrations between gates never during. The detailed rules stay in the v2 brief and its commercial addendum; each chunk names the sections it draws on and the rulings that apply, so nobody builds a superseded version.
**Companion:** `estimator-v2-progress.md` — the ledger every session reads first and updates last.
**The design:** `estimator-journey-v2.html` (v2.5, 10 Sep) is the approved experience. Every screen a chunk builds is named below by its id in that file; the **?** drawer on each screen is part of the spec. Build to the prototype, not from memory of it.

---

## 0. What the audit changed

Three things, in order of consequence.

**Self-sign is unsafe today, and not because of design.** Finding 9.1 is executed proof: `submit/route.ts:501` passes `wantsExterior` where the ladder expects the real `requires_site_check`, so an interior job with condition photos is told it can accept online while the database says it can't. The proving snapshot records the wrong answer, which quietly poisons the calibration baseline. Finding 9.2 means a cap changed in Settings changes rung 5 and nothing else. No customer fixes a price online, and no estimator trusts the proving window, until both are closed. They're chunks 1 and 2.

**The customer side is further along than the design assumed.** The quick look exists (`QuickLook.tsx`, `lib/wizard/quick-look.ts:360`: start → place → job → condition; outside for exteriors), coats are already derived per surface group (`lib/pricing/systems.ts:572 deriveSystem`, with `enforceCoverage` closing the one-coat-on-a-colour-change hole), condition spots already write prep hours (`spots.ts:197`), site access and exterior allowances already exist as settings rows, occupancy modifiers landed on 10 Sep, and `remoteConfirmCapCents` is already a policy setting. The v2 design maps onto this as *modifications* — new colour question, new details screen, the human moments, the commercial patterns — not a rebuild. Several sessions in the brief shrink by half.

**The estimator side is the gap, and it's the value.** There is no confirmation queue, no remote fix, no qualified-lead pack, no exterior finish line (`finish/page.tsx:49` dead-ends every exterior customer with "open your estimate to finish it off"). Everything the customer does upstream is only worth something if it lands on a person's desk as a job they can sign. So the loop moves from session 5 to Phase 1, immediately after hygiene.

---

## 1. Reference files — commit in C0, at these paths

    docs/briefs/estimator-v2-delta-and-plan.md              (this file — the operating plan)
    docs/briefs/estimator-v2-progress.md                    (the ledger)
    design/reference/estimator-journey-v2.html              (THE prototype, v2.5 — screens by id, ? drawers are spec)
    docs/briefs/estimator-journey-v2-plan.md                (plan of record v2.5 — the why, §8 trade, §9 pricing correlation)
    docs/briefs/claude-code-brief-estimator-journey-v2.md   (the detailed rules; read the v2.x correction blocks at the top FIRST)
    docs/briefs/claude-code-brief-estimator-journey-v2-addendum-commercial.md
    docs/briefs/commercial-estimator-experience.md
    docs/reference/wizard-audit-2026-09-11.md               (the audit this plan answers)
    docs/reference/wizard-current-flow-2026-09-09.md        (v1 as it was, screen by screen)
    docs/briefs/commercial-pricing-strategy.md              (untracked today — C0 commits it)

Kickoff ritual unchanged: commit, confirm the list back, STOP on anything missing.

### 1.1 Prototype screen → code that exists → chunk

The map Opus needs, since the design was drawn before the audit and the code was written before the design.

| Prototype screen (id) | What exists at `a1b28fc` | Chunk |
|---|---|---|
| `s-start`, `s-place`, `s-job`, `s-condition` | `app/wizard/QuickLook.tsx` steps `start`, `place`, `job`, `condition` | C8 (start), C9 (job), C10 (condition) |
| `s-both` | Nothing — `both` falls through to the interior list (`WizardApp.tsx:353-359`) | C8 |
| `s-ext-job` | `QuickLook.tsx` step `outside` (`:148-184`) | C4 (kind for commercial), C11 (copy) |
| `s-reveal` | The reveal inside `WizardApp` / `CustomerResult.tsx` | C11 |
| `s-tighten`, `s-room` | `app/estimate/scope/page.tsx` → `ScopeEditor`; spots in `lib/wizard/spots.ts` + room-spots UI | C10 |
| `s-systems` (the details screen) | `PageDetails` in `WizardApp.tsx` (page set) | C9 |
| `s-access` | Nothing on screen; `lib/wizard/site-access.ts` in the engine | C10 |
| `s-finish` | `app/estimate/finish/page.tsx` — interior only | C4 (exterior), C7 (fix online) |
| `s-handoff` | `app/estimate/sent/page.tsx` | C7 |
| `sheet-save` (Save & book) | Nothing | C8 |
| `sheet-keep` | The contact page, currently before the price | C8 |
| `sheet-extra` | The "anything we haven't listed" check card | C10 |
| `s-ext-sides`, `s-ext-side` | `SidesEditor` via `/estimate/scope` | C10 (photo per side), C14 (commercial outside) |
| `s-commercial`, `s-com-areas`, `s-com-job` | `PageProperty` segment + seven gates (`WizardApp.tsx:1678-1722`), `lib/wizard/commercial.ts:141` | C12 |
| `s-com-warehouse` | Nothing | C13 |
| `s-com-brief`, `s-com-book` | Nothing — commercial hands off to the page set | C14 |
| `s-trade`, `s-trade-sheet` | `/estimate?spec=` seed (`app/estimate/page.tsx:200-221`); `lib/portal/portfolio.ts` | C15 |
| Estimator strip, footer human line, inline offers | Nothing | C11 |
| Console queue and pack (not in the prototype — see §2.6) | Nothing | C5, C6 |

## 2. Design assumption → audit finding → consequence

| The v2 design assumed | The audit found | Consequence |
|---|---|---|
| A quick look must be built (S1) | Built. Four screens interior, three exterior, five both. Copy promises "four" on all three | S1 becomes screen-1 changes, the colour question, and the promise fixed to the real count |
| `wizard_sessions` with a version counter is a prerequisite | Table is `wizard_drafts`; no version column; last-write-wins autosave; three client copies | Chunk 3 adds the version and optimistic concurrency to the table that exists; nothing renames |
| `paint_system_rules` table to be created | `deriveSystem` exists in code; whether it's table-driven is unverified | Chunk 9 audits it, extends it to per-group colour intent, and makes it Settings-editable only if it isn't |
| Condition spots to be built | Built, plus `fix/spot-extent-quantity` unmerged improves them | Merge the branch; the room card reuses spots |
| Interior site & access never asked | `site-access.ts:135` writes prep hours; the UI is the question | Chunk 10 wires the allowances modifiers to a screen — no new engine work |
| Exterior per-elevation allowances don't exist | `exterior_allowances` settings row exists and applies at submit | Exterior guide range can be trusted sooner; ⚑15 widening may be smaller |
| Remote confirmation is a new policy outcome | `remoteConfirmCapCents` and `remoteConfirmInteriorOnly` already in `WizardPolicySettings` | The setting exists; the RPC and the console don't — chunk 6 |
| Commercial is a blanket hand-off | Segment question and seven gates exist (`commercial.ts:141`); commercial *exits* the quick look into five page-set pages | The v2.2 patterns replace the page-set exit; `routeCommercial` becomes a brief/range router |
| Trade is an account mode | A boolean at submit plus a saved-spec seed (`/estimate?spec=`) | Chunk 15 builds on the seed; the spec sheet is new |
| Assisted sessions are on the horizon | `/estimate/assist` exists — chat and live editor on the same tree | Assisted tighten exists in embryo; chunk 3's version counter makes it safe |
| The policy ladder is the single decision | Caps re-derived in four places from two settings keys with hardcoded money; `feat/one-ladder` fixes it, unmerged | Chunk 1 merges it first |
| Migrations are applied between gates | No production ledger; drift documented both ways; handoff doc stale since 6 Sep; number gaps and duplicates | Chunk 0 creates `_prod_migrations` and every future migration self-registers |
| `commercial-pricing-strategy.md` is a reference file | Cited by code, absent from the repo, untracked on disk | Chunk 0 commits it |
| Engine order runs through `engine.ts` | `engine.ts` is 80% dead; production path is `estimate.ts` without the finish-level guard | ⚑A: delete dead exports and move the guard, or record the split |
| One condition question per room (removed 10 Sep anyway) | Quick look has a free-text condition box | Strip it (§2.3) — photos price, prose doesn't |

---

## 2. Your six points

### 2.1 The most accurate quote in the fewest steps

The rule for every question from here on: **it stays only if it routes the job or moves the price by more than the band width at the stage it's asked.** A ±15% guide range doesn't earn a question worth 2%. Applied to what the audit found on screen:

| Question | Moves | Verdict |
|---|---|---|
| Address · inside/outside/both · kind · bedrooms · storeys | Routes, seeds the tree | Keep |
| Scope preset · what's changing colour · lighter-or-bold · still choosing | Coats and prep, 6–20% | Keep |
| Condition band · occupancy | Prep; allowances per crew-day | Keep |
| Condition free-text box (`QuickLook.tsx:119-140`) | Nothing — unpriceable | **Strip**; a photo prices, a paragraph doesn't |
| Contact page before the price | Nothing | **Move** after the range (⚑1) |
| Paint brand · water-based only · colour help (`PagePaint`) | Nothing at guide stage | **Strip** from the flow; colour consult lives in the portal |
| Door only vs door and frame | ~1% | **Strip**; frames always included |
| Door style · ceiling height | 2% · 12% on walls | Keep, on the details screen, "not sure" default |
| Window type, five options | ~3% | **Reduce** to hinged / sliding / aluminium / not sure |
| Heritage listed (page set) | Routes exterior colour approvals | **Move** to the exterior brief only; strip from interior |
| Exterior: storeys · materials · targets · condition · access flags · which sides | 10–40% | Keep — this is already the five-answer outside screen |
| Exterior "% of wall" material control on a side | Estimator-grade | **Strip** for customers; the photo per side does it |
| Room: size · surfaces · counts · robe doors · spots · extras | The price | Keep |
| Three whole-job checks (doors and windows totals · anything missed · missed rooms) | Overlap | **Fold** into one "anything we've missed" sheet |
| Commercial: the seven gates as a wall, then five page-set screens | Routes only | **Replace** with segment + which-part + two screens (v2.2) |

Targets after this: home interior **4 screens** to a guide range (no change in count, one fewer question per screen); exterior **3**; both **5**; commercial ranged **3** (from seven gates plus five pages); commercial brief **2 + book**. Tighten stays optional and every rung shows what it narrows.

### 2.2 Gamification — an honest view

Don't. Not because engagement doesn't matter — it does, and §2.4 is how to get it — but because tiers reward the wrong thing and cost you in three ways.

1. **It rewards completing our form.** The customer's goal is a fair price with the least effort. Naming the effort an achievement tells them it's a cost we're compensating them for. Someone spending $10,000 doesn't want a badge; they want to be sure.
2. **It couples marketing promises to accuracy tiers.** Gold means ±4% — the jobs with the thinnest margin for error. A free paint upgrade on exactly those jobs cuts margin where you can least afford it, and it whispers that the standard paint is the lesser one.
3. **It's gameable, and the gaming corrupts the data.** Tap "looks right" on every room and you're gold. The tier stops meaning "we're sure" and starts meaning "they tapped a lot" — and the calibration data, which is the moat, inherits the lie.

Priority booking has a fourth problem: it's an operations promise the calendar may not keep. Advertised as a tier benefit and not delivered, it's a consumer-law exposure, not a perk.

**What to keep from the instinct.** Engagement in this flow comes from four things that already exist in the design: the range narrowing live under the customer's own taps, a named person on screen, "what we'll do" in plain lines, and progress that's saved without asking. If you want a tangible benefit, make it one that's *true and costs nothing*, and state it as a fact at the moment it applies rather than as a tier:

- Add photos → "We can usually confirm from these — no visit needed, usually next working day." (Time, which is what they actually want.)
- Fix your price online → "You pick your start week first." True anyway: confirmed jobs are scheduled before unconfirmed ones.
- Book within the 60-day hold → price held; free samples and the colour consult included. Already policy.

If you still want tiers, run one benefit (start-week priority on fix-online) as a 90-day experiment inside the proving window and measure completion rate against guide-to-fixed drift. If drift rises, the tiers are teaching people to tap, and they go. My recommendation is not to start.

### 2.3 What can be stripped without touching the price

From §2.1, plus what the audit exposed underneath: the condition free-text box; the contact gate; the paint-preference page; door-only-vs-frame; two window options; the per-room condition question (already ruled); the three checks folded to one; the "% of wall" control; the describe-it and upload forks on screen 1 (assistant and tighten, respectively); the seven gates as a wall; and in code, the 80% of `engine.ts` nothing calls, the four copies of the cap decision, and the three copies of wizard state that chunk 3 collapses to one server truth with a client cache.

Nothing in that list moves a guide range by more than its band.

### 2.4 Why would a customer go anywhere else?

Because everyone else's process is: fill in a form, wait, a stranger visits, a PDF arrives days later with a number and no explanation, and then the phone tag starts. The flow beats that on five promises the customer can *see*, not read about:

1. **A number in a minute, no email first.** Nobody else in Melbourne shows a painting price before asking who you are.
2. **A named person from the second screen.** Sarah, her patch, her number. Not "one of our team".
3. **What we'll do, in plain lines, before you commit.** No competitor's quote says two coats after filling the small marks and a light sand. Yours does, on screen, for free.
4. **Photos instead of visits.** Send three photos on a Sunday night; a fixed price by Tuesday. The visit becomes the exception they can choose.
5. **Nothing is final until you say so, and nothing changes after.** Fixed price held 60 days; variations approved in writing; the walkthrough sign-off; the paint register afterwards.

The competitor can copy the dark theme. They can't copy a measured tree on file for the strata block, or a price register for every home you've painted. Those are §8 of the plan of record, and they're why the trade portal matters more than its size suggests.

### 2.5 Thinking as the customer — the second-guess pass

Walked screen by screen, asking what goes wrong for the person holding the phone:

| Screen | What goes wrong | The answer |
|---|---|---|
| Screen 1 | "Four quick screens" is false on two branches (audit 9.3b). Trust dented before it starts | The count is computed from `stepsFor`, never typed in copy |
| Screen 1 | A business visitor never sees the quick look — first Continue exits it (9.3a) | Commercial hand-off ties to the *place* step, not to every Continue |
| Place | "How many bedrooms" for a warehouse | Commercial routes to its own counts; no `beds` key is ever written for it |
| Job | "Colour intent" in painter words | "What's changing colour?" — tick what's changing, the rest stays |
| Condition | A text box that asks them to describe damage they can't price | Gone; a photo does it, pinned to the room |
| Reveal | A range with no idea what's in it | The assume list, each line tappable; What we'll do underneath |
| Reveal | "Tighten" reads as homework | Three doors of equal weight; "stop whenever you like" in the footer; Save & book in the header |
| Room | Adjusting a size they don't know | "Looks right" default; "let Sarah measure it" beside the fields |
| Details | "Are the trims gloss enamel?" | "Are the doors and skirtings shiny?" with a picture, and a photo shortcut |
| Finish (exterior) | Dead end — "open your estimate to finish it off" (9.4) | The sides finish line exists; every branch ends at a person |
| Finish | "Finalise my price" — finalise what? | "Send to Sarah"; what happens next in three steps |
| Commercial | Seven yes/no gates, then "someone will call" | The tile says online-or-visit before they tap; the brief ends in a booked slot |
| Any screen | They stop | Everything saved; the estimator opens the session where they left it |

### 2.6 The estimator is the product

The whole build exists so that an estimator you hire receives **qualified leads** and either signs them from a desk or turns up to sign — and so that the customers who don't need an estimator sign themselves. That makes the estimator console, not the wizard, the deliverable to judge the build by. Define the lead precisely:

**A qualified lead is an estimate that arrives with:** the scope tree (rooms or sides × surfaces × counts × sizes, amber where assumed, cyan where the customer confirmed); the derived paint systems; photos pinned to rooms and spots; site and access answers; compliance flags; the range and its accuracy band; the customer's chosen path (confirm from this / visit / call); contact and property history; and a **suggested action** from rules — photos present + interior + under cap → *confirm remotely*; exterior → *visit*; commercial → per segment; anything with a flagged review line → *ask or visit*.

**The estimator's day is the queue**, sorted by value × readiness, with three actions per card: fix the price (sends the fixed estimate), ask a question (in-thread, staff sends), book a visit (existing calendar). Every action writes the measured tree back to the property, so the next quote on that address starts from truth (§8.3 of the plan of record).

**Self-sign** is the fix-online RPC through the single ladder, at ≥ 90% accuracy under the cap, with the price held 60 days.

**The four numbers that say whether it's working:** hours from *sent* to *fixed*; share of estimates fixed without a visit; visit-to-signed rate; guide-to-fixed drift per segment. They come out of `confirmation_requests` and the proving snapshot — nothing extra to build, once 9.1 is fixed.

---

## 3. The plan in chunks

One session each. Sizes: **S** half a day, **M** a day. Every chunk starts with the preflight block in `estimator-v2-progress.md` and ends by updating the ledger. Paste the block in the grey box verbatim.

### Phase 0 — Ground truth and hygiene

**C0 — Ledger, stragglers, the missing brief · S · migration: one, additive**

    Read docs/briefs/estimator-v2-progress.md and run its preflight. Then:
    (1) commit docs/briefs/commercial-pricing-strategy.md — it is cited by
    lib/wizard/commercial.ts:3 and docs/ARCHITECTURE.md:2852 and is untracked
    on disk; (2) merge fix/tom-batch-10sep (one straggler commit past PR #60,
    no migration); (3) write migration 20270135000000_prod_migrations.sql
    creating public._prod_migrations(name text primary key, applied_at
    timestamptz default now()), output for Tom the backfill insert for every
    file in supabase/migrations/ so he can delete the rows he knows are NOT
    live, and add to CLAUDE.md the rule that every future migration ends with
    its own insert into _prod_migrations; (4) list the 262-behind stack
    (fix/ci-secret-names ⊂ fix/f1-02-seed-wizard ⊂ fix/a2-02-ratecard-
    transaction) with what each still contains that main lacks, for Tom to
    close or cherry-pick — do not merge them; (5) refresh docs/SESSION-
    HANDOFF.md with the 15 migrations since 6 Sep as AWAITS TOM ON PROD.
    Report the unit count before and after. No product changes.

Accept: the brief resolves from code · `_prod_migrations` migration written and the backfill SQL in the PR body · ledger has a row for C0.

**C1 — One ladder · M · migration: `20270132000000_wizard_policy_v2_keys.sql` from the branch**

    Rebase feat/one-ladder onto main and merge it: lib/wizard/ladder.ts
    becomes the only function that decides tier, self-serve and the next
    unlock. Delete the three re-derivations at lib/wizard/customer-scope.ts:
    145-156, app/api/estimates/[id]/wizard-edit/route.ts:1448-1455 and
    lib/agent/scope-tools.ts:441-444, and their hardcoded cents. While in
    policy.ts: fix the softReasons alias at :320 (copy, not reference) and
    align softForActor at :293-297 with the segment-route reason names
    (commercial_gate_strata, commercial_gate_healthcare) so a trade actor
    gets the same outcome from either question (audit 9.5). Tests: changing
    wizard_policy in Settings changes the scope editor, the edit route and
    the assistant identically; trade + strata → same outcome both paths.

Accept: exactly one function returns `canAccept` · grep for `600_000` and `1_200_000` outside settings defaults is empty · audit 9.2, 9.5, 9.6 closed with tests.

**C2 — `requires_site_check` decided once · S · no migration**

    Audit 9.1. Make requires_site_check a derived value from one function
    (in lib/wizard/ladder.ts from C1) that both app/api/wizard/submit/
    route.ts:501 and lib/wizard/customer-scope.ts:120 call; the submit route
    must never pass wantsExterior. The proving snapshot at submit/route.ts:
    512-522 records the derived value. Regression: interior job with one
    condition photo → canAccept false at submit AND on the scope page, and
    the snapshot's walkthroughRequired is true. Then report how many
    existing proving rows carry the wrong flag, with the SQL to correct them
    for Tom (do not run it).

Accept: the two callers cannot disagree (shared function, test) · corrected-rows SQL in the PR body · unit count reported.

**C3 — Draft versioning and one server truth · M · migration: add `version int`, `last_screen text` to `wizard_drafts`**

    wizard_drafts gets version (default 1) and last_screen. draft/route.ts
    updates only where version = expected and returns 409 with the server
    copy otherwise; the client merges on 409 (server wins for confirmed
    fields, client for unsaved edits) and never silently overwrites.
    localStorage becomes a cache of the last server copy, not a third truth.
    last_screen is written on every autosave. Check A1b (the 26-second
    silent wait) and either close it or file it with file:line. E2E as an
    anonymous customer: two tabs, one session, both editing → the second
    gets 409 and merges; refresh mid-room resumes in place.

Accept: no path updates `wizard_drafts` without a version predicate · the two-tab test green · `last_screen` present on resume.

**C4 — Outside + Commercial, and the exterior finish line · M · no migration** — prototype: `s-ext-job` (the kind question), `s-finish` for the sides bundle

    Audit 9.3 and 9.4 on the current code. (a) The commercial hand-off in
    WizardApp.tsx:1144 fires only on leaving the place step, never on the
    first Continue; ?mode=business still pre-selects Commercial but the
    visitor sees screen 1. (b) The screen-1 promise reads the real count
    from stepsFor(). (c) Exterior + Commercial never reaches PageExterior
    House — route to the hand-off screen with the address, job type and
    kind saved (the v2.2 exterior brief replaces this in C14; this is the
    stop-gap). (d) app/estimate/finish/page.tsx renders a sides finish line
    for exterior bundles instead of the holding message: the range, what
    they told us, "send to your estimator" and book a visit. Tests: all four
    job-type × kind combinations reach the correct next screen; an exterior
    customer reaches a finish line.

Accept: no path returns the customer to screen 1 without a message · exterior finish exists · four-combination e2e green.

### Phase 1 — The estimator loop

**C5 — The qualified-lead pack and the queue · M · migration: `confirmation_requests`** — no prototype screen; build to §2.6 and the existing console's design language

    Read brief §3 (confirmation_requests, site_checklist_items) and §2.6 of
    this plan. Migration: confirmation_requests per the brief plus
    suggested_action text and assigned_to. "Send for confirmation" from the
    existing finish and scope pages creates a row (kind=remote when the
    ladder's remoteConfirm settings allow, else visit) and freezes the pack.
    Console: a queue derived from confirmation_requests (no local list),
    sorted by tree total × readiness, and a pack view — tree with amber/cyan
    state, derived systems, photos pinned to rooms and spots, site & access,
    flags, range and band, the customer's path, contact and property
    history, and the suggested action from the rules in §2.6. Estimator
    assignment by postcode from staff records (add patch_postcodes to staff
    if absent — flag as migration for the next gate). CRM: confirmation_
    requested. E2E: customer sends → estimator sees the pack in under two
    seconds with every photo.

Accept: queue derives from the table alone · pack shows every field in §2.6 · suggested action matches the rules in a table test.

**C6 — Fix, ask, visit · M · no migration beyond C5**

    Three staff RPCs on a confirmation: fix_price (accept or enter the
    number; writes fixed_price_cents; sends the fixed estimate through the
    existing send path, guarded and idempotent; writes the measured tree to
    the property), ask_question (thread the customer sees on the sent screen
    and in the portal; auto-send OFF, staff sends), book_visit (existing
    scheduling). Customer-facing status on /estimate/sent derives from the
    row. CRM: price_fixed, visit_booked_from_wizard. A console warning card
    when a request is older than the turnaround setting. E2E: send → fix
    remotely → the customer's sent screen and portal show the fixed price;
    a double-click sends one email.

Accept: a fixed price can only originate from the RPC · the measured tree is written on fix · idempotency test green.

**C7 — Self-sign, the hold, and the hand-off screen · M · no migration** — prototype: `s-finish` (both variants — flip the prototype switch), `s-handoff`

    fix_online RPC through lib/wizard/ladder.ts at the moment of the tap
    (stale-client test: a session that no longer qualifies gets the
    confirmation path, kindly). Price fixed at the engine's central estimate
    (⚑8), held for hold_days (Settings, default 60). The hand-off screen per
    the prototype: the assigned estimator's name and patch, three concrete
    steps with the turnaround setting, optional booking slots, "your
    estimate is saved". "Send to <first name>" everywhere the button was
    "Finalise my price" (v2.4). E2E: a $4.8k interior fully confirmed → fix
    online → one number, held; a $10k one → send to Sarah → hand-off.

Accept: fix-online appears only when the server ladder says so · no hard-coded estimator name or number (grep) · both stories green.

### Phase 2 — Quick look v2, on the quick look that exists

**C8 — Screen 1, Save & book, "both", email after the price · M · migration: none (`last_screen` from C3)** — prototype: `s-start`, `s-both`, `sheet-save`, `sheet-keep`, the header pill

    Modify QuickLook.tsx and quick-look.ts, do not rebuild. Screen 1: the
    "rather not fill anything in?" card (Book someone in → the Save & book
    sheet; Call → office_phone from Settings). The Save & book pill in the
    header of every screen; the sheet per the prototype; save_and_book RPC
    per addendum §4.17 (snapshot + last_screen, ensureAccountAndProperty,
    confirmation_requests kind=visit, slot, magic link, events). "Both" →
    the choice screen; after the interior reveal, "now price the outside".
    Email moves after the range (⚑1): the contact page leaves the customer
    path; "keep this estimate" is the capture; a soft "email me a copy" bar
    under the range. Strip PagePaint from the customer path. E2E: nine taps
    to a range with no email; Save & book from screen 3 resumes the staff
    view at screen 3.

Accept: no email field before the range on any customer branch · Save & book on every screen · "both" shows two ranges.

**C9 — What's changing colour, the details screen, What we'll do · M · no migration unless `deriveSystem` is not table-driven** — prototype: `s-job` (colour block), `s-systems`, the `.do` panel on `s-reveal`, `s-tighten`, `s-finish`

    ⚑ ADDED 11 Sep (Tom): WHEN CEILING HEIGHT MOVES TO THE DETAILS SCREEN,
    ONE ANSWER MUST CREDIT EVERY ROOM. The accuracy dock for an assumed height
    is stored PER AREA (`assumedFields` contains "H"), and today the only thing
    that clears it is the `confirm_height` action, which maps over every
    interior room, sets H, strips "H" from each `assumedFields` and stamps
    `height_customer_stated`
    (`app/api/estimates/[id]/wizard-edit/route.ts:534`). A details screen that
    stores the answer anywhere else — a new column, a wizard-state field, a
    per-house setting — leaves every room still flagged, and EVERY customer
    then caps at 86% against a 90% bar. Reuse `confirm_height`; do not
    reimplement it. Its exterior guard matters too: an Exterior elevation
    carries a MEASURED facade height in H, which a ceiling answer must never
    overwrite.

    v2.3 ruling. Job screen: replace the colour-intent picker with the
    walls / ceilings / doors-and-trims tiles, lighter-or-bold, still
    choosing; per-group intent derived (undecided or changing → new, bold →
    dark, else same). Audit lib/pricing/systems.ts deriveSystem first and
    report: is it driven by rows or by code? If code, add paint_system_rules
    (migration for the next gate) with brief §6.1 as the seed and make
    deriveSystem read it; if rows, extend the key to per-group intent.
    Replace PageDetails with the details screen: door style, window type
    (four options), shiny doors and skirtings, ceiling height, photo
    shortcut; strip door-only-vs-frame. The What we'll do panel on the
    reveal, tighten and finish, read-only, from the derivation. Golden tests
    from brief S2 (2-coat and 3-coat totals unchanged; one coat unreachable
    for a changing group).

Accept: no paint-system control in any customer component · golden tests green · the panel's lines derive only from rules and state.

**C10 — Tighten: rooms, spots, one missed sheet, site & access · M · no migration** — prototype: `s-tighten`, `s-room`, `s-access`, `sheet-extra`, `s-ext-side` (photo per side)

    ⚑ ADDED 11 Sep (Tom), found by C7's e2e: THE FINISH LINE MUST NAME WHAT IS
    BLOCKING A FIXED PRICE. A customer who measures and confirms every single
    room still lands on 86% — because one unanswered fact, the ceiling height,
    docks every room 0.15 (`lib/wizard/accuracy.ts:69`) — and the
    "fix my price online" door simply is not there, with nothing on screen
    saying why. They did everything asked and the reward silently did not
    arrive. The finish line already knows the verdict (`payload.canAccept`) and
    already knows the reason (`payload.heightUnconfirmed`, the deferred list,
    the ladder's `nextUnlock`); it must say it in one line — "one thing left:
    ceiling height" — with the tap right there. Applies to every blocker the
    ladder can name, not only height.

    Merge fix/spot-extent-quantity first (rebase; no migration). Then the
    tighten screen on the existing ScopeEditor: room list with assumed
    size, surface summary and amber/cyan status; room card = size, surfaces
    with counts, robe doors, "anything needing extra attention?" over the
    existing spots, extras (feature walls counted, wallpaper, other-text
    flagged) — no per-room condition question (v2.5). Fold the three
    whole-job checks into one "anything we've missed" sheet. Strip the
    condition free-text box from the quick look. Site & access screen =
    cleared / floors / void / parking / lift booking, wired to lib/wizard/
    site-access.ts — no asbestos, no pets, no hard stop (v2.5); hazmat_check
    goes on site_checklist_items at confirmation. The assume list on the
    reveal, each line deep-linking. E2E: confirm three rooms and flag a
    crack; the range narrows three times; refresh mid-room resumes.

Accept: room chips, counts and the assume list read from the tree and one evaluator (no local counters) · no condition text field anywhere · spots create repair lines priced server-side.

**C11 — The human moments and the reveal · S · no migration** — prototype: `s-reveal`, the `.est` strip and `.foothuman` rows on `s-tighten`, `s-room`, `s-access`, `s-finish`, the `.offer` cards

    v2.4. The estimator strip on the reveal, tighten and finish from the
    assigned staff record; one footer human line per screen from a single
    evaluator (default / not-sures ≥ 2 / condition work / partly done / all
    done) with Book a visit beside it; inline offers on flagging a spot, on
    the size adjuster, and at two not-sures on the details screen; no
    footer nags. Tier labels Guide / Detailed / Confirmed over the existing
    band evaluator; the roller reveal with prefers-reduced-motion respected.

Accept: no "Book in your estimator" heading or icon-tile row · footer line derives from state (table test) · lighthouse mobile ≥ 90 on the reveal.

### Phase 3 — Commercial, on the segment code that exists

**C12 — Segments as data, the office pattern, the commercial reveal · M · migration: `commercial_segments`** — prototype: `s-commercial`, `s-com-areas`, `s-com-job`, `s-reveal` (commercial variant); the `SEG` object in the prototype's script is the seed

    Addendum S6a with the v2.2 and v2.3 rulings (no glass question; "online
    · or we visit" tags; retail includes hospitality; healthcare asks aged
    care / clinic / hospital; which-part row). commercial_segments seeded
    from the prototype configs. lib/wizard/commercial.ts routeCommercial
    becomes: route=range segments continue in the quick look (counts →
    open-space card → job screen → reveal with widened band, never fix-
    online); route=brief segments and any outside or both go to C14. The
    seven gates stop being a wall: height and equipment appear where
    relevant, hours is a loading (Settings ⚑21), induction and committees
    live on the brief. lib/pricing/commercial.ts: open-space wall area at
    the full perimeter, ceiling line only when plaster, EWP pass-through in
    height mode. Golden tests from S6a.

Accept: every segment string comes from the table · no commercial estimate can reach fix-online (test) · `glass` appears nowhere.

**C13 — The warehouse pattern · S · no migration** — prototype: `s-com-warehouse`, `s-com-job` (warehouse config)

    Addendum S6b: area brackets or L×W, height to the underside of the roof,
    industrial surfaces with counted doors, wall material, racking /
    operating / lift on site; the shared job screen; walls from area ×
    height × racking factor; no beds or storeys keys (assert).

Accept: S6b golden tests green · flagged items appear as "priced on confirmation".

**C14 — Briefs, booking, every commercial exterior · M · migration: `commercial_briefs`, `site_checklist_items`** — prototype: `s-com-brief` (the `BRIEF` object is the seed), `s-com-book`

    Addendum S6c with v2.5: brief configs for strata, shop front, hospital
    (no beds, no infection-control rows), something else, and exterior;
    photos; the booking screen with real slots and the turnaround copy;
    save_and_book with brief_id; site_checklist_items incl. hazmat_check;
    the C4 stop-gap for Exterior + Commercial replaced by the exterior
    brief. No reprice call on the brief path (RPC spy test); no number in
    the DOM.

Accept: booking creates account, property, request, calendar event and checklist items atomically · brief path never prices.

### Phase 4 — Trade

**Design gate before C15:** the trade-portal prototype (`trade-portal-v2.html`, plan of record §8.5), three business types, desktop and phone, approved.

**C15 — Building profiles, measured trees, saved specs, the spec sheet · M · migration: `building_profiles`, `properties.measured_tree`, `trade_specs`, `tenant_photo_links`** — prototype: `s-trade`, `s-trade-sheet`, then the trade prototype from the design gate

    Extend the /estimate?spec= seed into saved specs with CRUD; building
    profiles per the plan of record §8.3; the measured tree written by
    fix_price (C6) is the seed for every later quick look on that property;
    the spec sheet as a grid over the same tree with the same RPCs (parity
    test against the room card); tenant photo link; the register as the
    default colour answer (verify QuoteBuilder.tsx:1128 is closed). Trade
    never sees fix-online.

Accept: sheet and guided flow produce identical trees for identical input · rebook starts from the measured tree with zero re-typing.

### Phase 5 — Close

**C16 — Assistant hooks · S · no migration** — prototype: the chat bubble on every screen; assumed (amber) values on `s-room` and `s-ext-side`

    Per docs/briefs/claude-code-brief-assistant-agent.md within its own
    session plan: (a) "describe it" lives behind the chat bubble and writes
    the quick-look fields through the versioned draft (C3) with attribution,
    never bypassing it; (b) plan-reader proposals from side, room and
    open-space photos land as ASSUMED (amber) values the customer confirms —
    they never write a confirmed (cyan) value; (c) the assistant asks the
    commercial segment question (audit §4, lib/wizard/policy.ts:264-267)
    instead of falling back to commercialKind. No new AI surface.

Accept: assistant-written fields carry attribution and stay amber until confirmed · a plan-reader proposal cannot change a cyan value (test) · the assistant path emits the same segment reasons as the screen.

Tom's check: describe a job in the chat — the filled fields show as assumed (amber) until you confirm them.

**C17 — Hardening and the switch · M · no migration**

    Run the ten customer stories end to end as the real roles on the preview
    deploy — home ×3 (time-poor → book; careful → fix online → accept → WO;
    both → two ranges), commercial ×4 (office → remote fix; warehouse →
    visit booked from the console; strata → brief → visit; retail → send),
    trade ×3 (saved spec → sheet → send; rebook from a measured tree;
    tenant photos → confirmation) — and the failure stories (stale client on
    fix-online; version conflict from an assisted patch; both-commercial →
    visit; a request older than the turnaround setting). Fix everything
    found, in scope. Raise CI's e2e from 38 of 156 specs to at least every
    e2e/customer-journey spec; triage the 309 conditional skips (credentials
    present in CI, or the skip deleted). Delete the dead exports in
    lib/pricing/engine.ts and move the finish-level guard onto the
    production path (⚑A, if ruled). Write docs/help/estimator/{customer,
    commercial,staff,trade}}.md under the Phase A rule. Produce the
    wizard_public switch checklist: robots at app/estimate/page.tsx:31,
    Settings values confirmed, the v1 → v2 strangler window, what deletes
    after fifty jobs. Do NOT flip the switch.

Accept: ten stories and four failure stories green in CI · every customer-journey spec runs in CI · help files exist for all four roles · the switch checklist is in the PR body and the switch is still off.

Tom's check: walk all ten stories on the phone; the public switch stays off until you flip it.

---

## 4. Order, and why

Phase 0 before anything because 9.1 makes self-sign wrong today and 9.2 makes Settings lie. Phase 1 before the customer polish because the estimator loop is the value and it needs nothing from Phase 2 — the existing scope editor already produces a tree, photos and a range; C5 just gives them somewhere to land. Phase 2 modifies screens that exist. Phase 3 replaces the commercial exit. Phase 4 waits for its own design gate. C12–C14 can run in parallel worktrees after C11; nothing else should.

Roughly: Phase 0 four sessions, Phase 1 three, Phase 2 four, Phase 3 three, Phase 4 one plus a design gate, Phase 5 two. Seventeen sessions, each reviewable in one sitting.

---

## 5. ⚑ New decisions from the audit

| # | Decision | Suggested default |
|---|---|---|
| A | `engine.ts`: delete the dead 80% and move the finish-level guard onto the production path, or record the split? | Delete and move; the mutation canary keeps the coat rule covered |
| B | The six silent catch blocks guarding browser storage | Allow, with the comment mandatory — record the exception in CLAUDE.md |
| C | Heritage question | Exterior brief only |
| D | The 262-behind branch stack | Close after C0's report; cherry-pick anything main lacks |
| E | Production migration ledger | `_prod_migrations`, self-registering, backfilled by Tom once |
| F | CI e2e coverage | Every `customer-journey` spec runs in CI by C17 |
| G | Gamification | No tiers; one true benefit stated as a fact (§2.2); revisit only with proving-window data |
| H | Occupancy on the quick look | Keep — one tap, feeds allowances |
| I | Estimator assignment | By postcode from staff records; `patch_postcodes` column |
| J | Price hold on fix-online | 60 days, Settings `hold_days` |
| K | The `docs/reward-tiers-plan` branch | Merge the docs as history; the customer-flow-plan is superseded by the plan of record |

---

## 6. What to do first

1. Rule on A, D, E, G — they shape Phase 0.
2. Commit the reference files in §1 — the prototype at `design/reference/estimator-journey-v2.html` is the one Claude Code has never seen, and every Phase 2–4 chunk builds to it.
3. Paste C0. It's small, it produces the ledger, and it tells us whether the production migration picture is as murky as the audit suggests.
3. Then C1 and C2 back to back. Nobody self-signs before they're merged.
