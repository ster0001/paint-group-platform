# Build Brief — Work Order Completion Loop + PC Command Console

**Status:** ready to build · supersedes nothing (work orders v1 stays; this is the v2 loop on top)
**Buildout position:** item 1 of 7 in `post-wizard-buildout-order.md` — the spine. Invoicing, the customer portal and completion reports all hang off what this phase captures.
**Approved design:** the PC Command mockup (three views: Command / The flow / Work order). Build to that mockup, not from memory of it.

---

## 0. Where we are right now

What exists in the repo and must be built ON, not around:

- **Work orders v1** — WOs generate from accepted estimates, grouped by elevation, show level of finish. No stages, no ticks, no variations, no sign-off.
- **Scheduling + contractor portal phases A–F, complete** — staff timeline calendar, drag-drop booking requests, contractor accept/decline/propose with a 24h SLA, customer confirmation only after contractor acceptance, contractor self-invoicing. The stage-01 "offer" in this brief IS that existing offer flow — do not build a second one. The WO travels attached to the booking offer.
- **lib/pricing** — the engine. All variation pricing goes through it. Nothing money-shaped is computed in the browser, ever.
- **Server boundary remediation** — SECURITY DEFINER RPCs, zod'd server actions, client writes revoked on money/status columns. Every stage transition in this brief is an RPC. If any remediation step is unfinished on the tables this brief touches, finish it first and say so.
- **Design system (locked)** — Switzer + Martian Mono; ink/graphite/raised/line/text/muted; cyan #3BD8E9 (on-cyan #03272D), paint #2FB9CB, amber #E0A83C = awaiting, emerald #2FA46B, clay #B3574A. The approved mockup uses exactly these. Amber always means "waiting on a decision"; clay always means "overdue/breached".
- **Standing rules** — migrations run BETWEEN gate runs, never during one. E2e-first in the real role. Missing reference file = STOP and report.

What does NOT exist and is being built here: the 7-stage state machine, per-surface ticks, photo gating, variations, drafted daily updates, QA checks, walkthrough + sign-off (in-person and deemed), the derived attention queue, and the PC Command console UI.

---

## 1. Reference files — commit these first

    docs/briefs/claude-code-brief-wo-loop-pc-command.md      (this file)
    docs/briefs/work-order-completion-workflow.md             (the 7-stage workflow design)
    design/reference/work-order-lifecycle-mockup.html         (lifecycle diagram page)
    design/reference/pc-command-mockup.html                   (THE approved console mockup)
    docs/briefs/post-wizard-buildout-order.md                 (context: what depends on this)
    docs/briefs/acceptance-to-paid-workflow.md                 (G-phases; stage 7 hands over to it)
    CLAUDE.md                                                  (standards; STOP rule; e2e law)

**Kickoff ritual (law):** commit these files, then confirm the file list back in the session before writing any code. If any file is missing: STOP and report — do not reconstruct it from memory.

---

## 2. Business decisions — ⚑ ASK TOM, do not invent

Build every one of these as a **Settings value with the stated default**, and surface the open ones in the PR description so none ship silently.

| # | Decision | Default until Tom rules |
|---|---|---|
| 1 | QA cadence for new contractors | First 3 jobs auto-scheduled; established contractors none |
| 2 | Variation adjusted offer: auto-release on customer approval, or PC releases? | PC releases (a human between money events) |
| 3 | Rubbish/equipment courier default | PC organises, costed to the job |
| 4 | Warranty start date | Sign-off date (incl. deemed sign-off) |
| 5 | Photo minimums | ≥1 before-photo per elevation/area before first tick; ≥3 photos per QA check; thin record does NOT block QA pass, flags it |
| 6 | Deemed sign-off | 72h residential, nudges at 0/24/48h, clock starts on evidence-pack delivery. ⚑ Clause needs legal review (UCT) before quote terms mention it |
| 7 | Offer-SLA breach action | Console offers "Reoffer" (release to next contractor) — confirm this is the desired action, and whether it notifies the lapsed contractor |
| 8 | Attention-queue ranking | Severity order below (§6.2) — confirm |
| 9 | "Deposit paid" tile source | Reads invoicing when built; until then reads estimate acceptance record |

---

## 3. Data model (migrations — Tom pastes SQL between gate runs)

All money integer cents. All tables RLS'd three ways (PC/staff, contractor = assigned only, customer = own job only) with explicit `view=` param contract — **never role-inferred**.

    work_orders          + stage enum: offered | pre_start | in_progress | qa |
                           completion_prep | walkthrough | closed
                         + stage_entered_at, blocked_reason (nullable text)
    wo_checklist_items   wo_id, phase (pre_offer|pre_start|completion_prep),
                         label, required, done_at, done_by
    wo_surfaces          wo_id, elevation/area heading, label, sort,
                         state enum: todo | prepped | done,
                         state history (who/when per transition)
    wo_photos            wo_id, surface_or_area ref, kind: before|progress|qa|
                         completion|variation, storage path (magic-byte checked,
                         signed URLs — reuse remediated upload path)
    wo_variations        wo_id, raised_by, category, comment, est_hours,
                         status: raised | priced | customer_approved |
                         contractor_accepted | declined | cancelled,
                         priced_lines jsonb (engine output), customer_link token,
                         contractor_delta_cents (hours × 6000)
    wo_updates           wo_id, draft_text, source_tick_ids, status:
                         drafted | approved | sent, approved_by, sent_at
    wo_qa_checks         wo_id, scheduled_for, result: pass | fail,
                         photo refs, rectification surface ids appended
    wo_signoff           wo_id, evidence_pack_sent_at, views jsonb,
                         nudges sent, extension_requested/approved,
                         signed_at, signed_kind: in_person | remote | deemed,
                         per-area approvals/flags jsonb
    settings             + keys for every §2 value

**State machine (RPC-enforced, single source of truth):**

    offered ──accept──▶ pre_start ──checklist done──▶ in_progress
    in_progress ──all surfaces done──▶ qa (if scheduled) else completion_prep
    qa ──pass──▶ completion_prep · ──fail──▶ in_progress (+ rectification surfaces)
    completion_prep ──pack delivered──▶ walkthrough
    walkthrough ──all areas approved + signed──▶ closed
    walkthrough ──area flagged──▶ in_progress (+ rectification surfaces)

Illegal transitions throw. Every transition writes an event row (`wo_events`: wo_id, from, to, actor, at, meta) — the completion report and the console both read from events, so it's free later.

---

## 4. Server rules (non-negotiable)

1. Every stage transition, tick, variation status move, update approval and sign-off is a **SECURITY DEFINER RPC** with zod-validated input. No client writes to stage/state/money columns.
2. Variation pricing: RPC calls **lib/pricing** with the variation lines; contractor delta = engine hours × $60/hr (6000 cents) computed server-side. The customer approval link reuses the existing quote-token flow; the contractor acceptance reuses the existing job-offer flow.
3. Tick gating server-side: first tick on an elevation/area REJECTED unless a `before` photo exists for it. Not a UI hint — an RPC error the UI renders nicely.
4. Deemed sign-off: a scheduled job (cron/edge function) advances nudges and executes deemed sign-off at the Settings threshold. It writes the same events a manual sign-off writes, marked `deemed`. Extension request pauses the clock pending PC approval.
5. Zero-tick catch: scheduled job flags any WO `in_progress` with a booking for today/yesterday and no tick events — feeds the console, never auto-messages the customer.
6. Sign-off RPC is transactional and fires the downstream events (§7 stage 7) atomically.

---

## 5. Build order — copyable steps

One phase per Claude Code session. Paste the block, verbatim, at session start. **Gate runs green before moving on; migrations between gates.**

### Step 1 — Foundations: schema + state machine

    Read docs/briefs/claude-code-brief-wo-loop-pc-command.md fully. Confirm the
    reference file list back to me before writing code (kickoff ritual).
    Build §3: migrations for the WO loop tables (I will paste SQL into Supabase),
    the wo_events table, and the stage state-machine RPCs per §4.1 with zod.
    Illegal transitions must throw; every legal one writes an event row.
    RLS three ways with explicit view= param. No UI this step beyond a bare
    stage badge on the existing WO page. Golden tests: every legal transition,
    every illegal one, RLS denial per role. Do not touch pricing.

**Accept:** transition matrix fully tested · events written · client write to `stage` fails at the DB.

### Step 2 — Surfaces, ticks & photo gating

    Build wo_surfaces generation from the existing WO elevation grouping
    (v1 WOs already group by elevation — surfaces seed from those lines, with
    heading metadata like "Front — 12×2.6 m, weatherboard 75%/render 25%").
    Ticks: todo→prepped→done RPC with history; before-photo gate per §4.3 using
    the remediated upload path (magic bytes, signed URLs). Contractor view:
    tick tiles under elevation headings, photo prompt when gated.
    E2e AS THE CONTRACTOR: cannot tick before photo; tick history correct;
    all-surfaces-done offers the stage gate.

**Accept:** first tick without photo = server error surfaced kindly · 18/34-style progress derivable from data alone.

### Step 3 — Variations (two-sided)

    Build wo_variations per §3 and the flow per §4.2: contractor raises
    (category chips + comment + required photos + optional hours) → office
    prices via lib/pricing RPC → customer approves as mini-estimate on the
    existing quote-token link → contractor one-tap accepts adjusted offer
    (hours × $60 server-side) via the existing offer flow. Declined variations
    persist and will surface on the completion report. PC verbal override =
    a PC-entered variation marked override, still logged. Settings switch for
    ⚑ decision 2 (auto-release vs PC release), default PC release.
    E2e in all three roles for one variation, raised → work proceeds.

**Accept:** no variation reaches `contractor_accepted` without both approvals logged · contractor delta exactly hours×6000 cents · browser computes no money.

### Step 4 — Daily updates & the silent-site catch

    Build wo_updates: draft generated from the day's tick events (plain-English
    per elevation, photos attached count), PC approves/edits/sends. Nothing
    sends unapproved. Zero-tick scheduled job per §4.5 writes a console flag.
    Customer-facing copy in ENGLISH (not Australian) tone.
    E2e AS PC: draft appears after ticks, edit, approve, customer sees it
    (portal record now; email/SMS provider is a later phase — ⚑ already flagged).

**Accept:** update text derives only from real tick events · zero-tick day produces a flag, never an auto-message.

### Step 5 — QA, completion prep, walkthrough & sign-off

    Build wo_qa_checks (auto-scheduled per Settings cadence for new
    contractors), pass/fail with photos; fail appends rectification surfaces
    and returns stage to in_progress — SAME tick list, no parallel flow.
    Completion prep checklist. Walkthrough: customer per-area approve/flag
    (flag = rectification surfaces + back to in_progress), type-to-sign.
    Remote path: evidence pack delivery starts the §2.6 clock; nudge ladder,
    view tracking, extension request, deemed sign-off via scheduled job.
    Sign-off RPC atomically: warranty record (start per ⚑4), review request
    task, completion report generated from wo_events (ticks, photos,
    variations incl. declined, QA results), and an invoice stub for the
    invoicing phase to consume. E2e AS THE CUSTOMER for both paths.

**Accept:** QA fail and walkthrough flag land in the same tick list · deemed sign-off writes identical downstream events marked `deemed` · completion report renders with zero extra data entry.

### Step 6 — PC Command console (the approved design)

    Open design/reference/pc-command-mockup.html and build it as the real
    /pc route, 1:1: three views (Command / Flow / Work order), Switzer +
    Martian Mono, the exact palette, phone-first, reduced-motion respected.
    Command: headline summarising live state, four pulse tiles (on-the-books
    inc GST from open WOs, critical count, waiting-on-you count, signed-off
    this week), attention queue ranked per §6.2 with one primary action each.
    Flow: seven-lane pipeline, every open WO as a card in its stage lane,
    amber border = blocked on decision, clay = overdue, tap-through to the WO.
    The animated journey SVG from the mockup, with live counts.
    Work order view: stage rail, money strip (contract / variations /
    contractor / est GP / deposit), blocker banner from blocked_reason,
    elevation tick list read-only with progress bar, variation five-step
    tracker, drafted-update approve card, job facts.
    EVERY number on this screen is read from the model — no typed statuses.
    E2e AS PC: each queue item's action deep-links correctly; pipeline card
    stage matches wo_events; approve-and-send works end to end.

**Accept:** console renders from live data with zero manual fields · every §6.1 trigger produces exactly one queue card · visual parity with the mockup on a phone.

### Step 7 — Hardening & the full-loop e2e

    Run the entire loop as a single e2e story in four browsers/roles:
    estimate accepted → WO offered (existing scheduling flow) → contractor
    accepts → pre-start (colours first, then materials, equipment) →
    ticks with photos → variation raised/priced/approved/accepted →
    daily update approved → QA pass → pack sent → remote nudges →
    customer signs → warranty/report/invoice-stub/review all fired →
    console shows the job travelling every lane. Then the failure story:
    QA fail and a walkthrough flag, both rectified through the same list.
    Fix everything it finds. Update CLAUDE.md with any new standards learned.

**Accept:** both stories green in CI · no client-side money or status writes anywhere in the diff (audit greps clean).

---

## 6. Console logic (so it isn't invented twice)

### 6.1 Attention-queue triggers (each = one card, auto-clears when resolved)

| Trigger | Severity | Primary action |
|---|---|---|
| Offer past SLA (from existing scheduling SLA) | critical (clay) | Reoffer ⚑7 |
| Zero-tick day on an in-progress WO with booking | critical | Call crew (tel: link) + view WO |
| Variation status `raised` (awaiting price) | warning (amber) | Price it → engine |
| Colours unconfirmed within N days of start (N Settings, default 5) | warning | Open WO |
| Sign-off clock ≥ 48h (second nudge fired) | warning | Ring them (tel:) |
| Updates in `drafted` | info (cyan) | Review |
| Variation `priced`, customer >24h silent | warning | Nudge customer |
| Extension requested on sign-off clock | warning | Approve / decline |

### 6.2 Ranking: critical (oldest first) → warning (oldest first) → info. Headline counts derive from the same query.

### 6.3 Pulse tiles: on-the-books = Σ open WO contract values inc GST · critical/waiting = queue counts · signed-off-this-week from wo_events. Sparkline = tick events per day, 14 days.

---

## 7. Definition of done

1. A WO cannot reach `closed` except through the state machine, and every stage it passed through is reconstructable from `wo_events` alone.
2. The completion report for the e2e job renders complete — ticks, photos, variations (incl. one declined), QA, sign-off — with zero data entered specifically for it.
3. Contractor, customer and PC each see only their rendered view (RLS + view param proven by tests, not by inspection).
4. All §2 values live in Settings; the five still-open ⚑s are listed in the final PR body addressed to Tom.
5. The console is the mockup, breathing real data, on a phone.
6. `grep` audits: no `payment_cents|stage|state` writes from client code; no price arithmetic outside lib/pricing.

— End of brief. If anything here contradicts work-order-completion-workflow.md, that file wins for workflow semantics and this file wins for build order; report the contradiction either way.
