# Estimator v2 — run sheet for Claude Code (Opus)

**Tom: paste this whole file into a Claude Code chat as the first message. It runs the plan one chunk at a time and stops at every gate. To continue in a later session, paste only the line in §7.**

---

## 1. Read this first — how every session works

You are executing a fixed plan, one chunk per session, in order. The plan is `docs/briefs/estimator-v2-delta-and-plan.md`; the ledger is `docs/briefs/estimator-v2-progress.md`; the approved design is `design/reference/estimator-journey-v2.html`. The chunk blocks are reproduced in §5 of this file so nothing needs to be looked up mid-session, but the plan wins if they ever differ.

**The loop for every session, without exception:**

1. **Preflight** (§3). Report, then **wait for Tom to say go**.
2. **Build the one chunk** Tom names, to its block and nothing else.
3. **Gate**: `npm run build`, `npx tsc --noEmit`, lint, `npm test`, and the e2e specs the chunk names. Report actual output. Unit-test count before and after.
4. **Show the diff and wait** for approval before committing. Open a PR; the PR body lists every ⚑ the chunk touched and any SQL for Tom.
5. **Ask Tom to walk it on the preview deploy on his phone** — the line marked *Tom's check* under the chunk says what to look for. Do not merge before he confirms.
6. **Postflight** (§6): update the ledger row, commit it in the same PR, and **stop**. Do not start the next chunk in the same session.

**Standing rules, from `CLAUDE.md`, restated because they are the ones sessions break:**

- **No SQL executed, ever.** Migrations are written to `supabase/migrations/` and the SQL is pasted into the PR body for Tom. Migrations run between gates, never during one. Every new migration ends with `insert into public._prod_migrations(name) values ('<filename>');` once C0 has created that table.
- **A referenced file that does not exist is a STOP and report**, with the path. Never reconstruct it from memory.
- **No pricing arithmetic outside `lib/pricing/`; no policy decision outside the one ladder function** (from C1 on). No money in the client.
- **E2E is run as the anonymous customer**, on a non-production Supabase project. `e2e/global-setup.ts` refuses production; do not work around it.
- **No "while I was in there".** Anything you notice outside the chunk's block goes in `docs/briefs/estimator-v2-parking-lot.md` as one line with a file:line, and you carry on. Refactors, renames and cleanups outside scope are forbidden even when tempting.
- **Copy is English tone** (not Australian), money is AUD inc. GST as integer cents, and the estimator's name and phone number come from records and Settings — never typed into a component.

**Staying on track:**

- The chunk block is the contract. If a block cannot be done as written, STOP and report why with file:line, propose the *smallest* change to the block, and wait. Do not redesign.
- If you finish a chunk with time to spare, stop anyway. The next chunk starts with a fresh preflight in a fresh session.
- If the repo has already done part of a block (the preflight will tell you), say exactly what you are removing from the block and why, then build only what is left.
- If a test that was green goes red and it is not yours, report it — do not fix it unless it is inside the chunk's files.
- Every reply ends with one of: `WAITING FOR GO`, `WAITING FOR DIFF APPROVAL`, `WAITING FOR PHONE CHECK`, `BLOCKED: <reason>`, or `DONE — ledger updated`. Nothing else.

---

## 2. Step 0 — the reference files must exist

Before the first preflight, confirm each of these resolves. Print the list with ✓ or ✗. **Any ✗ is a STOP.**

    docs/briefs/estimator-v2-delta-and-plan.md
    docs/briefs/estimator-v2-progress.md
    design/reference/estimator-journey-v2.html
    docs/briefs/estimator-journey-v2-plan.md
    docs/briefs/claude-code-brief-estimator-journey-v2.md
    docs/briefs/claude-code-brief-estimator-journey-v2-addendum-commercial.md
    docs/briefs/commercial-estimator-experience.md
    docs/reference/wizard-audit-2026-09-11.md
    docs/reference/wizard-current-flow-2026-09-09.md
    CLAUDE.md

`docs/briefs/commercial-pricing-strategy.md` is expected to be **missing from git and present untracked on disk** — that is not a stop; committing it is C0's first task.

Then read, in this order, before the first preflight: the plan §0–§2, the ledger, the brief's correction blocks at the top of `claude-code-brief-estimator-journey-v2.md` (v2.1 → v2.5 — they override the body), and the prototype's map screen. Confirm back in five lines what the build is for (plan §2.6) so Tom knows you have it.

---

## 3. Preflight — run at the start of every session

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

End the reply with `WAITING FOR GO`.

---

## 4. The order, and the rules of the order

    Phase 0  C0 → C1 → C2 → C3 → C4        hygiene; nobody self-signs before C1 and C2
    Phase 1  C5 → C6 → C7                   the estimator loop — the value of the build
    Phase 2  C8 → C9 → C10 → C11            the customer screens, on the quick look that exists
    Phase 3  C12 · C13 · C14                commercial — may run in parallel worktrees after C11
    GATE     trade-portal prototype approved by Tom (a design deliverable, not a session)
    Phase 4  C15                            trade
    Phase 5  C16 → C17                      assistant hooks; hardening and the switch

Strictly in this order except C12–C14. A chunk is not started until the one before it is `DONE` in the ledger **and** Tom has confirmed its migrations are live. Sizes: S is about half a day, M about a day; if a chunk is running past that, stop, report where it is, and let Tom decide whether to split it.

---

## 5. The chunks

Build only the chunk Tom names. Each has its block, its Accept line (the definition of done), and what Tom checks on his phone before merge.

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

Tom's check: none on the phone. Read the backfill SQL and delete the rows you know are not live before pasting.

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

Tom's check: in Settings change the interior cap to $5,000, open a $5,500 estimate as a customer — the accept button is gone on the scope page AND in the assistant.

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

Tom's check: submit an interior job with one condition photo — no accept button anywhere; the proving row shows walkthrough required.

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

Tom's check: open the same estimate in two tabs, edit both, refresh — nothing is lost and the second tab tells you it merged.

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

Tom's check: screen 1 → Outside → Commercial → Continue reaches a hand-off with the address kept; an exterior job reaches a finish line.

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

Tom's check: send an estimate as a customer, open the console — the pack shows every room, photo and answer, plus a suggested action.

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

Tom's check: fix a price from the console; the customer's sent screen and portal show it; click fix twice and only one email arrives.

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

Tom's check: a small fully-confirmed interior job shows Fix my price online and one number; a large one shows Send to <estimator>.

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

Tom's check: nine taps to a range with no email asked; Save & book from screen 3, then open the session as staff — it lands on screen 3.

**C9 — What's changing colour, the details screen, What we'll do · M · no migration unless `deriveSystem` is not table-driven** — prototype: `s-job` (colour block), `s-systems`, the `.do` panel on `s-reveal`, `s-tighten`, `s-finish`

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

Tom's check: tick doors and trims as changing colour, then tap Shiny on the details screen — What we'll do gains an undercoat and a primer line and the range moves once per tap.

**C10 — Tighten: rooms, spots, one missed sheet, site & access · M · no migration** — prototype: `s-tighten`, `s-room`, `s-access`, `sheet-extra`, `s-ext-side` (photo per side)

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

Tom's check: confirm three rooms and flag a crack with a photo — the range narrows three times and the repair line appears on the estimate.

**C11 — The human moments and the reveal · S · no migration** — prototype: `s-reveal`, the `.est` strip and `.foothuman` rows on `s-tighten`, `s-room`, `s-access`, `s-finish`, the `.offer` cards

    v2.4. The estimator strip on the reveal, tighten and finish from the
    assigned staff record; one footer human line per screen from a single
    evaluator (default / not-sures ≥ 2 / condition work / partly done / all
    done) with Book a visit beside it; inline offers on flagging a spot, on
    the size adjuster, and at two not-sures on the details screen; no
    footer nags. Tier labels Guide / Detailed / Confirmed over the existing
    band evaluator; the roller reveal with prefers-reduced-motion respected.

Accept: no "Book in your estimator" heading or icon-tile row · footer line derives from state (table test) · lighthouse mobile ≥ 90 on the reveal.

Tom's check: the estimator's real name appears on the reveal, tighten and finish; the footer line changes after two not-sures.

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

Tom's check: Office → 4 offices, 1 open plan, 1 meeting room → a range in two screens; no Fix online anywhere.

**C13 — The warehouse pattern · S · no migration** — prototype: `s-com-warehouse`, `s-com-job` (warehouse config)

    Addendum S6b: area brackets or L×W, height to the underside of the roof,
    industrial surfaces with counted doors, wall material, racking /
    operating / lift on site; the shared job screen; walls from area ×
    height × racking factor; no beds or storeys keys (assert).

Accept: S6b golden tests green · flagged items appear as "priced on confirmation".

Tom's check: Warehouse → 1,000–2,500 m², 4–6 m, some racking → a range with the scissor-lift line shown.

**C14 — Briefs, booking, every commercial exterior · M · migration: `commercial_briefs`, `site_checklist_items`** — prototype: `s-com-brief` (the `BRIEF` object is the seed), `s-com-book`

    Addendum S6c with v2.5: brief configs for strata, shop front, hospital
    (no beds, no infection-control rows), something else, and exterior;
    photos; the booking screen with real slots and the turnaround copy;
    save_and_book with brief_id; site_checklist_items incl. hazmat_check;
    the C4 stop-gap for Exterior + Commercial replaced by the exterior
    brief. No reprice call on the brief path (RPC spy test); no number in
    the DOM.

Accept: booking creates account, property, request, calendar event and checklist items atomically · brief path never prices.

Tom's check: Strata → brief → booking creates a calendar event with the brief and photos attached; no number on any brief screen.

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

Tom's check: rebook a property from its last job — nothing to retype; the spec sheet and the room card give the same range.

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

---

## 6. Postflight — the last act of every session

    Add the row to docs/briefs/estimator-v2-progress.md: chunk, status DONE /
    PARTIAL / BLOCKED, date, merge SHA, migrations written (and whether Tom
    has confirmed them live), Settings keys seeded, unit count before → after,
    open ⚑s touched, and one line of "what the next session should know".
    Append any out-of-scope findings to docs/briefs/estimator-v2-parking-lot.md
    (one line each, with file:line). Commit both in the same PR. Then stop.

End the reply with `DONE — ledger updated` and the next chunk's name.

---

## 7. Tom: what you paste in every later session

    Continue the estimator v2 run sheet at docs/briefs/estimator-v2-runsheet.md.
    Run §3 preflight and wait.

Then, once you've read the preflight: **`Go: C<n>`**. Nothing else is needed.

**Your part between sessions:** paste the migration SQL from the PR body into production and tell the next session it's live; walk the preview deploy on your phone against *Tom's check*; rule on any ⚑ the PR body raises. The plan's §5 lists four rulings (A, D, E, G) that shape Phase 0 — give those before C0.

---

## 8. Finishing

The build is finished when C17's row is `DONE`, all ten customer stories are green in CI, Tom has walked every one of them on the phone, and the `wizard_public` switch checklist in C17 has been run. The public switch is Tom's to flip, never a session's.
