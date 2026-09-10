# Build Brief — Estimator Journey v2 (quick look · guide range · tighten · remote confirmation)

**Status:** ready to build, subject to the ⚑ decisions in §2 (each ships as a Settings value with the stated default — none blocks the first session)
**Buildout position:** replaces the question screens and the builder inside `/estimate`. Sits behind a new Settings switch `estimator_v2` alongside the existing Online estimates switch, so v1 and v2 can run side by side until v2 passes its gates. Feeds everything downstream: the estimate document, remote confirmation, WO loop, portal, trade portal, CRM events.
**Approved design:** `design/reference/estimator-journey-v2.html` (the clickable prototype — every screen, the NOTES drawer on each screen is part of the spec) and `docs/briefs/estimator-journey-v2-plan.md` (the why). Build to the prototype, not from memory of it. Where the prototype and this brief disagree on *behaviour*, this brief wins; on *look and copy*, the prototype wins; report the disagreement either way.

> **v2.3 correction (10 Sep, Tom's ruling — build to this, not to the 9 Sep prototype):** there is **no "how we'll paint each surface" screen**. The customer never confirms or corrects a paint system. Instead: (1) screen 3 asks **"What's changing colour?"** — tick walls / ceilings / doors and trims, then *any going much lighter or a bold colour?* (yes/no) and *still choosing colours?* (allow for new colours); (2) tighten rung 2 is **"A few details about what's there"** — door style, window type, are the doors and skirtings shiny, ceiling height — each with a picture and a "not sure", plus an optional photo of a door and skirting; (3) the derived paint systems render as a **read-only "What we'll do" panel** (plain lines, no controls, one "something not right? tell us" link) on the reveal, the tighten screen, the finish line and the estimate document. `colour_intent` becomes per surface group. Ceiling height moves off site & access onto the details screen.

> **v2.4 correction (10 Sep, Tom's ruling): the person is part of the experience, not a tile at the bottom.** Three changes, everywhere:
> 1. **The estimator is named and present.** A strip (avatar, name, patch, "Book a time" / "Call {office_phone}") renders on the reveal, at the top of the tighten screen and on the finish line — from the staff record assigned to that postcode, never hard-coded.
> 2. **Every footer carries one human line, derived from state**, not a tile row and not a nag. The line changes: default → "Rather Sarah measured it?"; two or more "not sure" answers → "A few not-sures? Sarah sorts those on site."; condition = work → "Repairs are easier to price in person."; partly done → "Sarah picks up the other {n} — call or visit."; all done → "All checked — Sarah confirms it, usually without a visit." One button beside it: Book a visit.
> 3. **Inline offers at the moments a person genuinely helps** — flagging damage or setting a room to "worse" (offer to book, or add a photo instead), two or more not-sures on the details screen, and "let Sarah measure it" beside the size adjuster. They appear at the point of difficulty, not at the bottom of the screen.
>
> **Copy replaced (do not ship the old strings):** "Book in your estimator" plus the three icon buttons — deleted. "Finalise my price" → **"Send to Sarah"** (the assigned estimator's first name). "You don't have to finish first — 2 of 12 confirmed. Tap Finalise my price whenever you like and a person picks up the rest with you." → **"Stop whenever you like — 2 of 12 checked so far. Send it and Sarah picks up the rest with you."** "Last change: The size question still needs an answer — 'Looks right' or adjust it." → no footer nag at all; the unanswered size stays amber on its own card and the room footer reads "Not sure? Leave it — Sarah checks it." "The final step is a quick call or a visit with one of our people, so we can stand behind every number." → moves into the estimator strip on the finish line: **"She checks every number before it's final. That's how we can stand behind it."**

> **v2.5 removals (10 Sep, Tom's rulings — do not build these):**
> 1. **No per-room condition question.** The whole-house condition band sets the prep; the room heading becomes "Anything needing extra attention?" over the existing photo-and-tag spot flagging. Drop `tree.rooms[].condition_override`.
> 2. **No asbestos question and no pets question** on site & access.
> 3. **No asbestos/lead hard-stop screen or outcome.** Remove the hazardous-materials `hard_stop` from the wizard's policy path (all other ladder outcomes unchanged). **Instead:** `site_checklist_items` gains `hazmat_check`, raised on every confirmation and shown above the tree in the estimator console — a trained person makes that call at confirmation or on site, and no price is acceptable without a person confirming it.
> 4. **Hospital brief:** no "approx. beds" row and no "infection control requirements" row.

> **The one-line version.** Under a minute and about nine taps to a guide range; then three doors with no hierarchy — tighten online, book a person, keep it; the customer never picks coats or prep, the engine derives them and shows them back in plain English; a confirmed scope tree plus photos lets an estimator fix the price without a visit.

---

## 0. Where we are right now

What exists in the repo and must be built ON, not around. **Verify each of these in code at kickoff and report what you actually find** — the briefs describe intent, the code is the truth.

- **Wizard rebuild R1–R5** — the room tree (`rebuild-addendum-confirm-loop.md`), confirm-loop editors, the interior "rooms" builder and the exterior "sides" builder, all pricing via `lib/pricing`. Every tap re-prices server-side. The tree is the one artefact; nothing here creates a second one.
- **Policy ladder** `lib/wizard/policy.ts` — hard stops → outside service area → human hand-off → below minimum → reveal. Self-serve caps: interior ≤ $6,000 at ≥ 90% accuracy, exterior never, `requires_site_check` never. Commercial is currently a blanket hand-off at ~line 216. **Do not re-implement this ladder. Extend it.**
- **Accuracy score → range band** — one evaluator (the audit removed the duplicate that returned 41% and 90% for the same job). Bands ±4 / ±8 / ±15. Tiers in this brief are *labels over that evaluator*, never a second computation.
- **Sessions** — anonymous session on entry (`lib/wizard/session.ts`, 3 bounded retries, 8s deadline); `ensureAccountAndProperty` on save; magic link proves the email. `wizard_sessions`, `wizard_events`, `wizard_assist_patch` RPC for staff joining a live session.
- **Server-first wizard state** — `wizard_state` jsonb on `wizard_sessions` with a version counter. **Required before this build.** If it is not merged, S0 does it first; nothing else starts.
- **A1b — the 26-second silent wait** — must be resolved before v2 is exposed to the public switch. Check its status in S0.
- **Allowances spec** (`wizard-project-allowances-spec.md`) — interior setup / cleanup / occupied / colour as unmultiplied flat adders, four Settings-editable modifiers (floors, cleared rooms, lift booking, parking), single-coat 1.25 factor as an override on `coats == 1`. The site-and-access screen in this brief is those modifiers, verbatim. Exterior per-elevation allowances **do not exist** — §2 ⚑15.
- **Pricing traps already caught** — catalogue lines must carry per-item charge-out, not the category rate; unit mismatches; multiplier chain applied once. The golden tests for these stay green throughout.
- **Uploads** — remediated path: magic-byte checked, signed URLs. Flagged-spot photos reuse it.
- **Commercial** — `commercial_rates` table exists and nothing reads it; `account_type: residential | trade`; `lib/portal/portfolio.ts` is the trade workspace view. The six gates and the segment question come from `commercial-pricing-strategy.md`.
- **Design system (locked)** — Switzer + Martian Mono; ink `#0A0B0D`, panel `#12161A`, line `#242B32`, text `#EDF0F2`, muted `#8C959D`; cyan `#3BD8E9` = told us / confirmed; amber `#E0A83C` = assumed / waiting. The prototype uses exactly these.
- **Standing rules** — migrations run BETWEEN gate runs, never during one; no SQL executed, output it for Tom; e2e-first as the anonymous customer is law; missing reference = STOP and report; one source of truth for every list and badge; worktrees with isolated ports for concurrent sessions; briefs committed the day they're produced; customer-facing copy in English (not Australian) tone; money integer cents, AUD, inc. GST on every customer surface.

What does NOT exist and is being built here: the four-screen quick look; the guide-range reveal with the assume list and three doors; the paint-system derivation lookup and its screen; per-room condition and flagged spots as repair lines; interior site-and-access; the extras sheet; the tier labels; the finish line driven by policy; remote confirmation in the estimator console; commercial segment + gates; the exterior five-answer quick look and photo-per-side; trade saved specs, address book, spec sheet and tenant photo link.

---

## 1. Reference files — commit these first

    docs/briefs/claude-code-brief-estimator-journey-v2.md   (this file)
    docs/briefs/estimator-journey-v2-plan.md                 (the design plan — why each screen exists)
    design/reference/estimator-journey-v2.html               (THE approved prototype; NOTES drawers are spec)
    docs/reference/wizard-current-flow-2026-09-09.md         (what v1 does today, screen by screen)
    docs/briefs/wizard-project-allowances-spec.md            (interior allowances + modifiers + 1.25 rule)
    docs/briefs/commercial-pricing-strategy.md               (segment question, six gates, appointment path)
    docs/briefs/commercial-estimator-analysis.md             (commercial substrates, products, area names)
    docs/briefs/rebuild-plan-v2.md                           (wizard rebuild phases — what R1–R5 delivered)
    docs/briefs/rebuild-addendum-confirm-loop.md             (room tree structure, confirm-loop editors)
    docs/briefs/business-inputs.md                           (typical room sizes, rate card values)
    docs/briefs/claude-code-one-page-build-instruction.md    (read order and non-negotiables)
    docs/briefs/customer-portal-experience-map.md            (B4: builder embedded in portal; W2–W4 trade)
    docs/briefs/claude-code-brief-assistant-agent.md         (describe-it and plan-reader hooks, S8)
    docs/briefs/paint-group-agent-knowledge-base.md          (what we do — prep lists the systems copy must match)
    docs/help/README.md or the CLAUDE.md help-content rule    (role-scoped help files per feature)
    CLAUDE.md                                                (standards; STOP rule; e2e law)

**Kickoff ritual (law):** commit these files, then confirm the file list back to Tom in the session before writing any code. If any file is missing: STOP and report — do not reconstruct it from memory. Then read `lib/wizard/policy.ts`, `lib/pricing/engine.ts`, the tree types, `lib/wizard/session.ts` and the current `app/estimate` route, and report in five lines how each maps to §0 above.

---

## 2. Business decisions — ⚑ ASK TOM, do not invent

Build every one of these as a **Settings value with the stated default**, and list the still-open ones in each PR body addressed to Tom so none ships silently.

| # | Decision | Default until Tom rules |
|---|---|---|
| 1 | Email before the price (v1) or after, as "Keep this estimate"? | **After.** A soft "email me a copy" bar sits under the guide range; the keep sheet is the full capture. `started_not_finished` retarget fires only once an email exists. Settings switch `email_gate_position: before \| after` |
| 2 | The coat and prep derivation table (§6.1) | Ship §6.1 as `paint_system_rules` rows, Settings-editable, versioned with the rate card |
| 3 | Ceilings on a new-colour job: one coat white-on-white by default, or two? | One; "they're marked" tap → two |
| 4 | Trims on a same-colour job: one coat or two? | Two; one only when condition band is `good` |
| 5 | Ask "are the trims currently gloss?" or default to not-sure → estimator check? | Ask it, three taps, on the systems screen; `not_sure` sets `requires_estimator_check` on the trims group |
| 6 | Flagged spots: auto-price minor tags, review the rest? | Auto-price `crack`, `nail_hole` from `defect_prep_rates`; all others create a repair line marked `estimator_review` with $0 shown as "priced on confirmation" |
| 7 | Remote confirmation cap and scope for v1 | Interior only, tree total ≤ $12,000 inc. GST, `remote_confirmation_enabled` off until Tom flips it |
| 8 | "Fix online" locks the top, midpoint, or a computed point of the range? | The engine's central estimate, shown as a single number; the range collapses to it |
| 9 | Raise the $6,000 interior self-serve cap? | No change in this build. Revisit at fifty remote confirmations |
| 10 | Bathrooms: ask, or infer? | Infer — 1 for ≤ 2 beds, 2 (bathroom + ensuite) for 3+; customer can add or remove |
| 11 | Trade self-acceptance | Never in v1; every trade price goes to confirmation |
| 12 | Trade default view: spec sheet or guided? | Spec sheet by default; guided flow when the address is new to the account |
| 13 | Turnaround promise on the hand-off screen | "usually by the next working day" — Settings string `confirmation_turnaround_copy` |
| 14 | "Describe it" on screen 1 as a card, or behind the chat bubble? | Behind the bubble; the assistant brief owns it (S8) |
| 15 | Exterior guide range before per-elevation allowances exist? | Show it with the ±15 band widened by `exterior_range_widen_pct` (default +5), and the equipment exclusion stated on screen |
| 16 | Hazardous materials | **Ruled 10 Sep:** no customer question and no hard stop; `hazmat_check` on the estimator's site checklist, raised at every confirmation |
| 17 | "Both" (inside and outside) in one session | Run the interior quick look, then the exterior quick look with storeys carried over; one combined guide range; tighten shows rooms then sides |
| 18 | The phone number and estimator names shown to customers | Settings: `office_phone_display`, estimator display names from staff records — no hard-coding |

---

## 3. Data model (migrations — Tom pastes SQL between gate runs)

All money integer cents. All new tables RLS'd with the explicit `view=` contract (customer = own session/estimate; staff/PC = all; contractor = none here) — **never role-inferred**. Nothing below stores a derived value that the tree already implies.

    wizard_sessions        + wizard_state jsonb, state_version int     (prerequisite — S0)
                           + entry: quick_look | trade | portal | assisted | call_prefill
    wizard_state (jsonb shape — additive to the existing tree)
                           quick_look: { job, kind, beds, storeys, scope_preset,
                                         colour_change: { walls:bool, ceilings:bool, trims:bool },
                                         colour_bold: bool, colour_undecided: bool,
                                         (derived per group: colour_intent = undecided||changing ? (bold ? dark : new) : same),
                                         condition_band: good|wear|work,
                                         occupied: bool,
                                         commercial_segment?, gate_answers? }
                           tree.rooms[].extras: { feature_walls:int, wallpaper_strip:bool,
                                                   robe_doors:bool, other_text? }
                           tree.groups[]: per surface group — derived system snapshot
                                         { coats, prep_steps[], primer?, overrides{} }
                           details: { door_style: panel|flat|ns, window_type: case|sash|alu|ns,
                                      trims_gloss: yes|no|ns, ceiling_height, photo_ids[] }
                           assigned_estimator_id  (from staff by postcode — drives every human surface)
                           site_access: { cleared, floors, void, parking,
                                          lift_booking? }
                           exterior: { storeys, materials[], elements[], condition,
                                       access_flags[] } + tree.sides[] as today
    paint_system_rules     versioned with the rate card (rate_card_version FK):
                           surface_group, colour_intent, condition_band,
                           coats int, prep_steps text[], primer text|null,
                           factor_override numeric|null, notes
                           (rows per §6.1; the engine reads these, nothing else does)
    condition_flags        session_id, estimate_id?, room_ref | side_ref,
                           tag enum: crack|nail_hole|flaking|water_mark|hole_dent|
                                     mould|wallpaper|rot|cracked_render|rust|other,
                           note text, photo_path (remediated upload),
                           priced_line_id (nullable → repair line in the tree),
                           status: auto_priced | estimator_review | priced | dismissed,
                           created_by (customer|staff), created_at
    confirmation_requests  estimate_id, requested_at, requested_by (customer|staff),
                           kind: remote | visit | fix_online,
                           status: requested | question_asked | fixed | visit_booked |
                                   declined,
                           assigned_to (staff), fixed_price_cents?, fixed_at?,
                           question_thread_id?, visit_booking_id? (existing scheduling)
    trade_specs            account_id, name, spec jsonb (scope preset, systems overrides,
                           condition band, colour policy: register|choose), created_by
    tenant_photo_links     property_id, token, expires_at, uploaded_photo_ids[],
                           requested_by, status
    settings               + keys for every §2 value
    crm_events             (existing, append-only) + event kinds:
                           guide_range_viewed, tighten_started, tighten_room_confirmed,
                           estimate_kept, confirmation_requested, price_fixed,
                           visit_booked_from_wizard

**Derived, never stored:** the tier (`guide | detailed | confirmed`), the range band, "N of M rooms confirmed", the assume list, and whether "fix online" is offered. One evaluator each, in `lib/`, read by every surface.

    tier = confirmed   if a confirmation_request with status fixed exists for the estimate,
                       or the estimate is accepted at a fixed price
         = detailed    if accuracy band is ±8 or ±4
         = guide       otherwise

---

## 4. Server rules (non-negotiable)

1. **Derivation lives in `lib/pricing/systems.ts`.** Input: the per-group `colour_intent` derived from `colour_change` + `colour_bold` + `colour_undecided`, `condition_band`, surface group, `details` (gloss → bonding primer; window_type alu → windows removed), overrides. Output: coats, prep steps, primer, factor. The engine consumes it; the wizard renders it; nothing else computes coats. The single-coat 1.25 factor stays an override on `coats == 1` per the allowances spec — **do not change the marginal rule.**
2. **Single coat is unreachable except for a group whose `colour_intent = same`.** A tree with any surface group at 1 coat whose group intent ≠ same is rejected by the reprice RPC. `colour_undecided` forces every group to `new`.
3. **Policy ladder order is unchanged.** Add outcomes, do not reorder: `remote_confirmation_offered` (after reveal, when the tree total ≤ ⚑7 cap and the job is interior) and `commercial_gate_tripped` (any gate = yes, before reveal). `requires_site_check` still blocks fix-online, always.
4. **Flagged spots price server-side.** `condition_flags` insert RPC: validates the upload, looks up `defect_prep_rates` for auto-priced tags, writes the repair line into the tree, reprices, writes a `wizard_events` row. The browser sends a tag and a photo path, never a price.
5. **Every reprice is one pass.** Adding a room, confirming a size, changing a system, flagging a spot, answering access — each triggers exactly one server reprice that recomputes surfaces, allowances and flags together, then returns the range and the delta toast text.
6. **Fix online** is an RPC that re-runs the policy ladder server-side at the moment of the tap, fixes the price at the ⚑8 point, writes `confirmation_requests(kind=fix_online, status=fixed)` and the CRM event, and only then shows the fixed number. A stale client that no longer qualifies gets the confirmation path instead, kindly.
7. **Remote confirmation** is a staff-only RPC family: `fix_price`, `ask_question`, `book_visit`. Each writes `wizard_events` and `crm_events`. The customer-facing status on the hand-off screen and in the portal derives from `confirmation_requests`, never from a typed status.
8. **Keep this estimate** calls the existing save path (`ensureAccountAndProperty` + magic link) and emits `estimate_kept`. With ⚑1 = after, a session with no email is still a valid session — retargeting simply has no address yet.
9. **Assisted sessions** patch the same `wizard_state` through `wizard_assist_patch` with attribution; every screen in the tighten stage renders the attribution chip when a staff patch exists for that field.
10. **No client-side money.** `grep` audit at every gate: no price arithmetic outside `lib/pricing`, no coat logic outside `lib/pricing/systems.ts`, no tier logic outside its evaluator.

---

## 5. Build order — copyable steps

One session per step. Paste the block verbatim at session start. **Gate runs green before moving on; migrations between gates; show the diff and wait for approval before committing.** Each step ends with a phone walkthrough on the preview deploy before merge. Sessions S6, S7 and S8 may run in parallel worktrees once S5 is merged; S1–S5 are serial.

### S0 — Prerequisites, read-through and the v2 switch

    Read docs/briefs/claude-code-brief-estimator-journey-v2.md fully, then the
    plan and the prototype (open every screen, open every NOTES drawer). Confirm
    the reference file list back to me before writing code (kickoff ritual).
    Then report, with file:line evidence, the status of: (a) server-first
    wizard_state + version counter on wizard_sessions, (b) A1b long-wait
    feedback, (c) the allowances spec — merged or not, (d) the single accuracy
    evaluator and its band mapping, (e) the policy ladder outcomes list.
    If (a) is absent, build it in this session: wizard_state jsonb, state_version,
    optimistic concurrency on patch, wizard_events row per patch, resume on
    reload, and a migration from the IndexedDB shape. If (b) or (c) are absent,
    STOP and report — they are separate batches.
    Add Settings switch estimator_v2 (default off) and route /estimate to v1 or
    v2 by it. v2 renders a placeholder this session. Seed §2 Settings keys with
    their defaults. No pricing changes.

**Accept:** state survives a refresh and a 24h gap · two tabs patching the same session get a version conflict, not a silent overwrite · `estimator_v2` off shows v1 unchanged · unit suite count reported before and after.

### S1 — Quick look and the guide range

    Build screens 1–5 of the prototype 1:1: address + inside/outside; kind/beds/
    storeys (bathrooms inferred per ⚑10); scope preset + "what's changing colour?"
    (walls / ceilings / doors and trims tiles, lighter-or-bold yes/no, still
    choosing yes/no — NO "same / new / dark" picker); condition band + occupied;
    then the reveal with the read-only "What we'll do" panel under the assume
    list (plain lines from the derivation, one "tell us" link that writes a
    flagged note). "Some rooms" adds one screen after
    condition: the seeded room list as tick tiles. "Both" per ⚑17. Seeding: the
    room tree from business-inputs.md typical sizes, surfaces from the scope
    preset, coats/prep from the DEFAULT rules in §6.1 hard-coded for this session
    only (S2 moves them to paint_system_rules — leave a TODO with the S2 tag).
    The reveal: range from the existing accuracy band (guide), the basis
    sentence, the assume list generated per §6.3 (each line deep-links), the
    three doors, the roller reveal (respect prefers-reduced-motion), the phone
    number from Settings on every screen. Email per ⚑1: soft bar under the
    range + the keep sheet; keep calls the existing save path and emits
    estimate_kept. Policy ladder runs before reveal exactly as v1 (hard stops,
    area, minimum). Every screen writes wizard_events. CRM: guide_range_viewed.
    E2E AS AN ANONYMOUS CUSTOMER: land → nine taps on defaults → range in under
    60s on a throttled 4G profile → keep → magic link arrives → resume lands on
    the reveal with the same range.

**Accept:** nine taps to a range on defaults · range equals v1's range for the same tree (parity test) · no coat picker exists anywhere · every assume-list line lands on the screen that changes it · lighthouse mobile ≥ 90 on the reveal.

### S2 — Paint-system derivation in the engine

    Build lib/pricing/systems.ts and the paint_system_rules table per §3/§6.1,
    versioned with the rate card, editable in Settings > Rate card. Replace the
    S1 hard-coded defaults. Wire the engine to read derived coats per surface
    group; keep coat_factor as a lookup on the total coat count with 1 → 1.25
    ONLY when colour_intent = same (§4.2). Golden tests: (1) a 2-coat job's
    total is unchanged from before this session, (2) a 3-coat job likewise,
    (3) same-colour vs new-colour on an identical tree differ only in walls and
    trims lines, (4) a tree with 1 coat and colour_intent=new is rejected by the
    reprice RPC, (5) allowances identical across all three colour intents,
    (6) every rule row round-trips through the Settings editor.
    Build screen 8 as "A few details about what's there" (v2.3): door style
    (panelled / flat / not sure, picture tiles), window type (timber hinged /
    timber sliding / aluminium — not painted / not sure, pictures), are the
    doors and skirtings shiny (shiny / flat / not sure, pictures — ⚑5),
    ceiling height (moved here from site & access), and an optional photo of a
    door and skirting. Each answer is one reprice with a delta toast. No paint
    system controls anywhere. The "What we'll do" panel (S1) re-renders from
    the derivation after every answer; its sentences must match the prep
    lists in the agent knowledge base.
    E2E as the customer: tick "doors and trims" on screen 3 and answer
    "shiny" here; see the undercoat and bonding-primer lines appear in "What
    we'll do" and on the estimate, and the range move once per answer.

**Accept:** golden tests 1–6 green · "What we'll do" sentences derive only from rule rows + state · no paint-system control exists in any customer component (grep for `override` in `app/estimate` is empty) · no coat or prep text is hard-coded in a component.

### S3 — Tighten: rooms, room card, flagged spots

    Build screens 6 and 7. Tighten overview: sticky range bar with the tier
    meter (derived), N of M rooms chip (derived), the room list (name, assumed
    size, surface summary, amber/cyan status, flagged-spot count), floorplan/
    listing upload at the top of the rooms rung (move the existing plan-reader
    entry here; remove it from screen 1), add-a-room, the three other doors with
    their status chips, the always-available "Finish and send" footer, the chat
    bubble. Room card: size confirm/adjust (L×W in metres, ceiling height NOT
    here — it lives on site & access), surface tiles with the derived system in
    small text and −/+ counts for doors and windows, add-a-surface from the rate
    card, robe doors, condition override (same/better/worse), point-out-a-spot
    (photo via the remediated upload path + tag + note → condition_flags RPC per
    §4.4 → repair line), extras (feature walls counted, wallpaper, other-text
    flagged not priced), Confirm <room>. Confirming writes tighten_room_confirmed.
    Attribution chips render where wizard_assist_patch has touched a field.
    E2E as the customer on a phone: confirm three rooms, flag a crack with a
    photo in one, watch the range narrow three times and the repair line appear
    on the estimate document; refresh mid-room and resume in place.

**Accept:** room list, chip, meter and footer all read from the tree + evaluators (grep: no local counters) · flagged spot creates exactly one repair line, priced server-side · a `worse` room with no photo still confirms (photo optional) · v1 builder unreachable when `estimator_v2` is on.

### S4 — Site & access, extras, the finish line, the hand-off

    Build screens 9, 10 and 11 and the extras sheet. Every footer gets the
    human row per v2.4 (one derived line + Book a visit); the finish line gets
    the estimator strip carrying the stand-behind-every-number line.
    Site & access: cleared / floors / void / parking / lift booking (units
    only) — each mapped to the allowances modifiers (spec §4). No asbestos,
    no pets, no hard-stop screen. Extras sheet:
    the common extras as rate-card lines, description box → flagged line.
    Finish line: kicker and meter derived (guide-so-far vs detailed), the summary
    list from the tree (every line deep-links), the options driven by the policy
    ladder — fix online (§4.6) when it qualifies, else send for confirmation
    (kind=remote when ⚑7 allows, else kind=visit), plus book-a-visit and
    call-back always. Hand-off: named estimator from staff records, the three
    steps with ⚑13 copy, optional booking slots via the EXISTING scheduling
    system, "your estimate is saved" with the masked email. CRM events:
    confirmation_requested, price_fixed, visit_booked_from_wizard.
    The estimate document (customer-facing) gains the derived system lines,
    allowance lines, repair lines and flagged extras in plain English.
    E2E as the customer, two stories: (a) a $10k interior → send for
    confirmation → hand-off; (b) a $4.8k interior fully confirmed → fix online
    → single fixed number, held 60 days, portal shows it.

**Accept:** fix-online appears only when the server-side ladder says so (test the stale-client case) · allowance lines on the printed estimate change when cleared/floors change · both e2e stories green.

### S5 — Remote confirmation in the estimator console

    Build the staff view: a confirmation queue (one card per
    confirmation_requests row in requested/question_asked, derived — no local
    list), and the confirmation screen: the tree as the estimator sees it
    (rooms, sizes, systems, allowances), the flagged spots with photos inline,
    site & access answers, the customer's range, and three actions — Fix price
    (enter or accept the engine's number; writes fixed_price_cents, emails the
    fixed estimate via the existing send path, guarded and idempotent), Ask a
    question (writes a thread the customer sees on the hand-off screen and in
    the portal; auto-send OFF per the standing rule — staff sends), Book a visit
    (existing scheduling). Repair lines in estimator_review get priced here.
    Console attention queue: a confirmation older than the ⚑13 promise raises a
    warning card (one card, auto-clears). Settings: remote_confirmation_enabled,
    remote_confirmation_cap_cents.
    E2E: customer sends → staff fixes remotely → customer's hand-off screen and
    portal flip to the fixed price → CRM shows price_fixed → the estimate
    document is the fixed one.

**Accept:** a fixed price can only originate from the RPC · queue derives from `confirmation_requests` alone · the fixed estimate email fires once on a double-click · every estimator_review repair line is either priced or dismissed before fix_price succeeds.

### S6 — Commercial gates, exterior quick look, hard stops

    Commercial: on kind=commercial, the segment screen + six gates (prototype
    branch screen, questions verbatim from commercial-pricing-strategy.md).
    Any yes → commercial_gate_tripped → the hand-off screen with a commercial
    estimator, everything saved, account + magic link created (the "appointment
    path done properly"). All no → office or shop front continue to the interior
    quick look with commercial area names (commercial-estimator-analysis.md
    phase 1 names), band widened per the strategy, fix-online never offered.
    Exterior: the five-answer quick look (storeys, materials, elements,
    condition, access flags) → reveal with ⚑15 widening and the equipment
    exclusion sentence → the sides builder (keep the existing plan-from-above and
    side cards) with a photo-per-side prompt at the top of each side card
    (upload only this session; reading it is S8). "Needs a lift or scaffold"
    sets requires_site_check.
    E2E: three stories — small office all-no → range; strata any-yes → hand-off
    with account; exterior weatherboard → range → one side checked with a photo
    → finish and send (exterior always confirmation, never fix online).

**Accept:** no commercial job reaches fix-online · a tripped gate still creates the account and saves the scope · exterior range shows the widened band and the exclusion copy · hard-stop screens show no number anywhere in the DOM.

### S7 — Trade: saved specs, address book, spec sheet, tenant photos

    For account_type=trade only (gates from the portal experience map §3/§6):
    trade landing (prototype "Quote from a saved spec"): saved specs (trade_specs
    CRUD, three seeded per the prototype), the account's properties with
    one-tap rebook (prior tree as starting point, wizard asks only what's
    changed), "somewhere new" → guided quick look (⚑12). The spec sheet: rooms ×
    surfaces × coats grid over the SAME tree, cell taps = the same reprice RPCs
    as the room card, range in the header, condition band, colours defaulting
    from the property's colour register (this is the fix for the colour-collapse
    bug at QuoteBuilder.tsx:1128 — verify it's closed, do not reintroduce a
    per-quote colour store). Tenant photo link: token page, phone-first, photos
    pin to the property and appear as condition_flags for the estimator.
    Trade sends always go to confirmation (⚑11). Ranges show immediately.
    E2E as a trade user: saved spec → sheet → change two cells → tenant link →
    photos land → send → staff sees them in S5's screen.

**Accept:** the sheet and the room card produce identical trees for identical input (parity test) · rebook starts from the prior tree with zero re-typing · colour register is the single colour source on the sheet · trade never sees fix-online.

### S8 — Assistant hooks

    Per claude-code-brief-assistant-agent.md, within that brief's session plan:
    (a) "Describe it" moves behind the chat bubble — the assistant's guided mode
    fills wizard_state through the same patch RPC with attribution, and the
    quick look screens show what it filled; (b) plan-reader on exterior side
    photos and interior room photos → proposed surfaces/counts/condition
    written as ASSUMED (amber) values the customer confirms, never as confirmed;
    (c) the hand-off "ask a question" thread is the assistant's support surface
    with the hard-stop scripts intact. No new AI surface is created here; this
    session wires the existing plan to v2's screens.

**Accept:** assistant-written fields carry attribution and stay amber until the customer confirms · plan-reader output never changes a cyan value · hard-stop scripts fire from the thread exactly as from the bubble.

### S9 — Hardening, full-loop e2e, help content, the switch

    Run the three customer stories end to end on the preview deploy as the real
    roles: time-poor homeowner (range → book a visit → hand-off → booking on the
    calendar); careful homeowner (range → all four rungs → fix online → accept →
    WO generated with the flagged spots and systems on the contractor's list);
    trade (spec → sheet → tenant photos → send → remote fix → portal). Then the
    failure stories: stale client on fix-online; commercial gate
    tripped; version conflict from an assisted patch. Fix everything found.
    Load: 50 concurrent quick looks on the test project — reprice p95 under 1s,
    reveal under 60s on throttled 4G. Write docs/help/estimator/customer.md,
    staff.md and trade.md under the Phase A rule, with the GIF walkthroughs.
    Update CLAUDE.md with the systems.ts rule (§4.1) and the derived-tier rule.
    Report the v1 → v2 switch plan: which Settings flips, what stays behind for
    the strangler window, and what deletes after fifty jobs.

**Accept:** all three stories and four failure stories green in CI · grep audits clean (§4.10) · help files exist for all three roles · load figures reported, not asserted.

---

## 6. Logic (so it isn't invented twice)

### 6.1 Paint-system rules — the default rows (⚑2, Settings-editable, versioned)

| surface_group | colour_intent | condition_band | coats | prep_steps | primer | notes |
|---|---|---|---|---|---|---|
| *(colour_intent per group is derived: undecided or changing → new (dark if bold); otherwise same)* | | | | | | |
| walls | same | good | 1 | light sand, dust off | — | 1.25 factor applies |
| walls | same | wear | 1 | fill nail holes and hairline cracks, light sand, spot-prime fills | — | 1.25 factor applies |
| walls | same | work | 2 | patch, sand back, seal patches | — | 1 coat not offered at `work` |
| walls | new | any | 2 | fill, light sand, spot-prime fills (+ patch/seal at `work`) | — | |
| walls | dark | any | 2 | as new | undercoat | |
| ceilings | same | good/wear | 1 | dust off | — | ⚑3 |
| ceilings | same | work | 2 | stain-block marks, sand | — | |
| ceilings | new | any | 1 | dust off | — | override "marked" → 2 |
| ceilings | dark | any | 2 | as new | — | |
| cornices | follows ceilings | | | | | |
| trims (skirting, architrave, frames) | same | good | 1 | sand and clean | bonding primer if gloss=yes | ⚑4 |
| trims | same | wear/work | 2 | sand, fill dents, clean | bonding primer if gloss=yes | |
| trims | new / dark | any | 2 | sand, fill, clean | undercoat; bonding primer if gloss=yes | |
| doors | follows trims | | | both sides, edges, frame | | |
| windows (timber) | same | any | 2 | sand, fill | rot treatment from flags | |
| windows (timber) | new / dark | any | 2 | sand, fill, putty check | undercoat | |
| windows (aluminium) | any | any | 0 | removed from scope | | override on systems screen |
| feature wall | any | any | 2 | as walls | +1 coat if `bold` | priced as its own colour |
| new plaster (flag) | any | any | 2 | — | sealer | |
| bare timber (flag) | any | any | 2 | — | primer | |

Exterior groups (walls by material, eaves/fascia, gutters/downpipes, windows, doors) get their rows from the existing exterior rate items in S6; the same table shape, the same editor.

### 6.2 Range, tier and the meter

- Band comes from the existing accuracy evaluator only. Tier labels per §3. The meter lights `guide` at ±15, `detailed` at ±8 and ±4, `confirmed` only when a fix exists. The tighten stage never lights `confirmed`.
- Exterior and commercial widen by their Settings percentages before display; the underlying accuracy is unchanged.
- The "N of M rooms" chip counts rooms in the tree with `confirmed_at` set; M is the tree's room count.

### 6.3 The assume list (reveal screen) — generated, one line per source

| Line | Source | Deep-link |
|---|---|---|
| "{M} rooms at typical sizes — {first three}…" | tree | tighten |
| coats sentence | derived systems for walls / ceilings / trims | systems |
| prep sentence | condition_band | tighten |
| access sentence | site_access defaults | access |
| occupied sentence | quick_look.occupied | access |
| exterior: sides, materials, equipment exclusion | exterior state | ext-sides |

### 6.4 Finish-line options (server-side ladder, evaluated at render AND at tap)

| Condition | Primary | Secondary |
|---|---|---|
| interior, total ≤ self-serve cap, accuracy ≥ 90, no `requires_site_check`, not commercial, not trade | Fix my price online | Have a person check it first |
| interior, total ≤ ⚑7 cap, `remote_confirmation_enabled` | Send for confirmation (remote) | Book a site visit |
| otherwise (exterior, commercial, over cap, site check) | Send for confirmation (visit) | Request a call back |

Call-back and the phone number are on every variant.

### 6.5 Delta toast

Every reprice returns `{ range, delta_cents, delta_label }`; the client renders `delta_label` verbatim ("Walls now undercoat + two coats  +$640"). The label is composed server-side from the diff of tree lines — the browser never computes or words a delta.

---

## 7. Copy

- The prototype's copy is authoritative for every screen it shows. English (not Australian) tone: warm, plain, unhurried; "Inside / Outside" not "Interior / Exterior"; sentence case; no acronyms customer-side; every empty or error state says what to do next and shows the phone number.
- Money: `$9,400 – $12,900` with an en dash and thin spaces, "Includes GST" on every range, "inc. GST" on fixed numbers.
- Copy the prototype doesn't have: propose in the PR body, tagged `copy:new`, and keep it under the tone rules. Copy tagged `pending_legal` (hard stops, remarketing consent) is not final until Tom says so.
- Prep sentences on the systems screen must match the "What we do" lists in the agent knowledge base word for word where they overlap — the customer will compare them.

---

## 8. Definition of done

1. An anonymous customer on a phone reaches a guide range in under sixty seconds and nine taps, and every screen after it is optional.
2. No coat picker and no paint-system control exists. Every coat and prep decision in the system is reconstructable from `paint_system_rules` + `wizard_state` (colour_change, bold, undecided, condition, details), and `grep` finds no coat logic outside `lib/pricing/systems.ts`.
3. A 2-coat and a 3-coat job price identically to the day before S2 (golden tests), and a single coat is unreachable with a colour change.
4. Tier, band, room counts, the assume list, the finish-line options and the confirmation queue each have exactly one evaluator, read by every surface, with no local counters or typed statuses anywhere (audit greps clean).
5. A confirmed scope tree with flagged photos lets a staff member fix a price from the console without a visit, and the customer sees that fixed price in the hand-off screen, the portal and the estimate document — all three reading the same `confirmation_requests` row.
6. Commercial gates, exterior, hard stops and trade all run through the same tree, the same engine and the same policy ladder; none of them reaches fix-online.
7. All §2 values live in Settings with their defaults; the still-open ⚑s are listed in the final PR body addressed to Tom.
8. The three customer stories and four failure stories are green in CI as the real roles; help files exist for customer, staff and trade; CLAUDE.md carries the new rules.
9. The assigned estimator's name appears on the reveal, the tighten screen, the finish line and in every footer human line, sourced from the staff record — `grep` finds no hard-coded name or phone number, and no screen contains a "Book in your estimator" heading or an icon-tile row.
10. The footer human line is derived from state (not-sures, condition band, progress) by one evaluator, and no footer nags about an unanswered field.

— End of brief. If anything here contradicts the allowances spec, that spec wins for allowance arithmetic; if anything contradicts `commercial-pricing-strategy.md`, that document wins for the gates; this brief wins for build order and screens. Report the contradiction either way.
