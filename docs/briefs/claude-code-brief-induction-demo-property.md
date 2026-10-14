# Build Brief — Contractor Induction, Demo Property & Language Choice

**Status:** ready to build once Step 0 has been reported back · written 13 October 2026, updated the same evening with five rulings (worker logins, demo isolation, translation testing, English-only demo)
**Approved content:** the Claude Doc "Paint Group Contractor Induction" (13 modules, sign-off, refresher). Tom approved the plan and rulings on 13 Oct 2026; the module wording is his to edit in that doc.
**Builds on:** `claude-code-brief-standards-status-callbacks.md` (the standards sign-off, status light, call backs), the contractor portal (scheduling + portal phases A–F), the work order loop, cost capture (expenses), and the messaging system. It extends the standards sign-off into a full induction. It does not replace it.

> **Written without repo access.** Paths, table and column names come from earlier briefs. Step 0 checks every one against the code before anything is built. Where the code disagrees, STOP and report. Never build a parallel version of something that exists.

---

## 0. What this is, in plain English

New contractors sit a three-hour induction: slides on a big screen, and on their own phone a practice job called **12 Demo Street** where they do each step for real. Each module ends with a tick. When every tick is in, the induction is complete. Existing contractors do a 60-minute refresher with the same ticks.

Four things get built:

1. **The demo property.** A seeded practice job on every contractor's account that behaves like a real job but answers itself: the office and the customer are robots. It never counts toward anything.
2. **The induction sign-off.** The six standards ticks already specified grow into thirteen module ticks, a practical check recorded by staff, a completion record and a PDF.
3. **Language choice.** The contractor picks a language at the start. Only the wording they read and tick to confirm understanding is shown in it, including the standards sections. The app, the slides and the demo job stay in English.
4. **Worker logins and the portal gaps the induction depends on:** a limited login for each contractor's workers so they can do the induction and tick their work, plus ask a question from a job, log a finish-date change, request more materials and "no work today".

**End to end:** invite → language → account → induction modules with the demo job → ticks → practical check → complete → insurance in → first job offer → day-one visit → first three jobs checked → the status light takes over.

---

## 1. Reference files — commit these first

    docs/briefs/claude-code-brief-induction-demo-property.md     (this file)
    docs/induction/induction-v1.md                              (export of the approved Claude Doc, all 13 modules)
    docs/briefs/claude-code-brief-standards-status-callbacks.md (standards sign-off, status, call backs — build on it)
    docs/briefs/claude-code-brief-wo-loop-pc-command.md         (stages, surfaces, ticks, walk-through, variations)
    docs/briefs/claude-code-brief-cost-capture.md               (contractor expenses)
    docs/briefs/claude-code-brief-employed-painters.md          (lead painter, crews)
    docs/briefs/messaging-automations-inventory.md              (every message the platform sends)
    design/reference/contractor-status-standards-mockup.html    (painter screens, light + dark)
    CLAUDE.md · docs/ARCHITECTURE.md

**Kickoff ritual (law):** commit the two new files, confirm the list back in the session, STOP on any missing file. `docs/induction/induction-v1.md` is the Markdown export of the Claude Doc (rev 16, 13 Oct 2026) and ships with this brief; the doc stays the wording authority, the export is what the loader reads. When Tom edits the doc, re-export it to the same path.

---

## 2. Rulings (Tom, 13 Oct 2026) — settled, do not re-open

| # | Ruling |
|---|---|
| I1 | Onboarding becomes a **signed-off induction**: slides on screen, the contractor doing each step on their phone in a demo job, one tick per module. Painters learn by touch and sight, so nothing is a document to read. |
| I2 | **13 modules** as written in the induction doc. Module 5 is the approved finish standards and keeps its six ticks. |
| I3 | **The demo property** is a repeatable job on every contractor's account, run on their phone and on the big screen. It is a walled-off loop: it does nothing on production, and anything that would normally wait on a person (variation pricing, customer approval, replies) **happens automatically** to show what a real job does. |
| I4 | **Every contractor can reset their own demo**, so several people in a room can work independently. |
| I5 | The induction **continues without certificates**. Missing documents are shown and chased afterwards. |
| I6 | Lateness: tell Paint Group **the day before**, or **before 7:30 am** on the day. |
| I7 | **Tolerance on scope is "fair and reasonable"**, with examples, not a number. Small omissions are part of the job; what is small depends on the job length. Anything not itemised in the scope may be charged as a variation. Small extras for the customer are encouraged. |
| I8 | **Language:** the portal, the slides and the demo job stay English. Only the wording the contractor reads and ticks to confirm understanding is in their chosen language, picked at the start, including the standards sections. Starting set: English, Dari (Afghan), Farsi, Arabic (Lebanese), Spanish, Portuguese (Brazil), Italian. Tom's team tests each language and returns changes. This reverses the earlier "English only" ruling for this wording only. |
| I9 | The induction is **unpaid**. |
| I10 | **Materials:** Paint Group supplies paint and perishables, delivered to site where practical, otherwise ordered to the nearest paint shop. Contractors bring all non-perishables (ladders, spray gear, pots, trays, poles, sanding gear, power tools). Paint Group loans special gear where available, returned like for like. Colour matches pre-arranged where practical. |
| I11 | **Workers get their own logins**, because every painter on a Paint Group job does the induction. A worker login is limited: the worker induction and standards sign-off, the jobs their contractor shares with them, surface ticks and photos. **Invoicing, variations and messaging stay with the owner.** (Ruled 13 Oct, replacing the earlier link-only idea.) |
| I12 | **One real text** is sent during the induction, marked DEMO, as the example of a reminder prompt, during the status-light module. |
| I13 | Existing contractors do the **60-minute refresher**, not the full induction. |
| I14 | **No uniform or ID.** |
| I15 | Say **"Project Coordinator"**, never a staff member's name, anywhere a painter reads it. |
| I16 | **Red = no more job offers**, and a meeting about the finish on the current job (ruled 11 Oct). |
| I17 | The sample board is **not mentioned** on any slide; it is facilitator kit only. |

---

## 3. Business decisions — ⚑ ASK TOM, do not invent

Settings values with the stated default; list the open ones in the PR.

| ⚑ | Decision | Default until Tom rules | Blocks |
|---|---|---|---|
| 1 | Offers gate after induction | Induction complete AND practical check passed AND public liability on file. WorkCover required only when `workers > 1`. | — |
| 2 | Afghan language: Dari, Pashto or both | Dari, served also to Farsi speakers until a separate Farsi file exists | Translation order |
| 3 | Translation method | Machine translation first; Tom's team tests each language and returns changes. A language is OFF until Tom switches it on. | Go-live per language |
| 4 | What the DEMO text says and from which number | The normal reminder wording with "DEMO:" in front, from the normal sending number | — |
| 5 | Practical check not passed | Facilitator marks "not yet"; contractor repeats modules 10–12 the same day; offers wait | — |
| 6 | Demo visible after induction | Yes, forever, under a "Demo" heading; staff can hide it per contractor | — |
| 7 | Robot reply delay | 5 seconds, so the room sees it happen | — |
| 8 | Who else sees the demo | The contractor, the workers they share it with, and staff. Never customers. A worker doing their own induction gets their own demo copy with only the worker steps. | — |
| 9 | Re-tick cadence | Material change → that module only; every 12 months → all modules | — |
| 10 | Refresher delivery | In person or video call; the ticks are the same either way; no practical check | — |
| 11 | "Ask a question" routing | To the Project Coordinator's attention queue with the job attached; reply shows in the job | — |
| 12 | Finish-date change | Contractor proposes a new date with a reason; PC confirms; customer told by the existing automation | — |
| 13 | What a worker login can do | See the jobs shared with them: scope, standards links, photos, surface ticks. Add before and progress photos. Tick surfaces (the tick is recorded against the worker, the job stays the contractor's). Never money, invoices, variations, the status light or messaging. | — |
| 14 | How a worker is added | The contractor adds name and mobile; the worker gets a magic-link login (same passwordless pattern as customers). The contractor can remove a worker, which revokes access at once. PC sees every contractor's workers and their induction state. | — |
| 15 | Worker induction gate | A worker cannot be shared onto a job until their worker induction is complete. PC Command shows "not inducted" on crew lists. | — |
| 16 | Who runs the worker induction | Paint Group, in group sessions, using the worker version of the deck. A contractor may sit in but does not sign for their workers. | — |
| 17 | Worker induction content | Modules 2, 3, 4, 5, 6 (what counts, no light of their own), 7, 8 (tell your boss, never agree extras), 9, 10 (photos and stages only), 13. No money or calendar. Practical check: open the job, add a before photo, move a surface to prepped. | — |

---

## 4. The demo property — exact behaviour

### 4.1 The seed

One fixed job, **12 Demo Street**: interior, Level 3, 40 hours over 5 booked days, 2 bedrooms, lounge, hallway. Surfaces: walls, ceilings, cornices, skirting boards, architraves, window frames, doors. Customer "Demo Customer". Contract value and contractor offer shown as realistic sample figures, flagged demo.

Planted events, in the order the modules use them:

| Module | Planted thing | What the robot does |
|---|---|---|
| 2 | Job sitting at `offered` | Nothing until accepted |
| 4 | Materials list with delivery marked "to site"; one item short | "Request more" → reply in 5 s: "Ordered. Collect from [shop] tomorrow." |
| 6 | The DEMO text | Sent by the facilitator's "Send demo prompt" button; tapping the link opens the demo job; any update marks the prompt answered |
| 7 | "Ask a question" | Reply in 5 s: "Thanks, your Project Coordinator will call you today." |
| 7 | "Change finish date" | Logged; reply in 5 s: "Noted. We will update the customer and the walk-through." |
| 8 | An extra door not in the scope | Variation raised → priced in 5 s → customer-approved in 5 s more → waits for the contractor's Accept → appears on the demo invoice |
| 9 | Finish checklist, final photo, walk-through | Walk-through mode: the demo customer flags Hallway walls; "Fixed" → walk again → all approved → sign (any name) → job `closed` |
| 10 | Offer to accept; add a worker and share the demo; before-photo gate; stages | Accept → booking confirmed in 5 s. Adding a worker creates a real worker login; sharing gives that worker their own view of the demo job. Photo gate and stages behave exactly as a real job |
| 11 | Invoice and one expense | Submit → approved in 5 s; expense → approved in 5 s; a payment date shown, nothing paid |
| 12 | Calendar | Real calendar: block-out and Google link are the real features, not demo |

### 4.2 Rules

- **A walled-off loop in the same app.** The demo job is rendered by the same screens as a real job, so it can never drift from the real app, but its data is walled off: a `work_orders` row with `is_demo = true` on it and on every child row, never joined to a real customer, invoice, payment or message. The flag changes only: the robot responses, the "Demo" banner, and the exclusions below. Nothing the contractor does in the demo touches production records.
- **Never counts.** Excluded from: the painter status evaluator, job results, call backs, bonuses, payables and the contractor's invoice list totals, the customer portal, PC Command counts and queue, the home dashboard, the MYOB export, reminder-moment scoring, and every customer-facing message. One filter, applied in one place (a view or a scope), not re-implemented per query.
- **The robots run server-side** on the existing cron or job infrastructure, write the same events a real action writes, and go through the same state machine. A robot never bypasses a gate the real flow enforces (for example the before-photo gate). Where the real flow needs a PC approval, the robot is the PC.
- **Reset** = delete the contractor's demo rows and re-seed from the template, in one transaction, in under 5 seconds. Button inside the demo job for the contractor; staff can reset any contractor's demo. Reset writes one event.
- **Progress** = a demo checklist of the "On your phone" steps per module, ticked automatically when the step is done (accept, share, photo, stage, question, date change, variation accepted, walk-through signed, invoice submitted, expense submitted, day blocked, calendar linked). Staff see a live grid: contractors in the room × steps.
- **The DEMO text** goes through the existing messaging adapter and inventory, wording editable, prefixed "DEMO:". Sent only by the facilitator's button, never by the scheduler.
- **Facilitator's own demo** is the same seed on a staff account, so the big screen matches the phones.

---

## 5. The induction sign-off and language

- **Language choice** is the first screen of the induction. Stored on the painter's profile as `induction_language`. What is translated: the text of each module the contractor reads in the sign-off flow, the six standards sections, the thirteen tick statements and the PDF. What stays English: every app screen, the demo job, the "On your phone" step names, the slides. The contractor can change language later; the record keeps the language they confirmed in.
- **Content as data.** Induction modules live in `induction_modules` and `induction_blocks` with one row per language per block, loaded from `docs/induction/induction-v1.md` (English) and the translation files. A language is served only when its `live` flag is set by staff after Tom's team has tested it (⚑3). A missing translation falls back to English, never to a blank.
- **Ticks.** `induction_acks(painter_user_id, version_id, module_key, acked_at, language)`, one per module; Module 5 keeps the six `standards_acks` rows from the standards brief and counts as ticked when all six are in. **Complete** = every module ticked. Completion writes an event and emails the PDF.
- **Practical check.** `induction_checks(painter_user_id, version_id, task_key, result (pass|not_yet), checked_by, checked_at)` for the five tasks, recorded by staff only.
- **Gate.** The existing offer RPC's standards gate (standards brief §6 rule 2) becomes: induction complete AND practical check passed AND insurance on file (⚑1). Existing contractors: refresher ticks + six standards ticks, no practical check, with the grace period already specified.
- **Refresher** = a second induction version with modules 3, 6, 7, 8, 9 only, plus the standards ticks, assigned to existing contractors. Same tables, `version_kind = refresher`.
- **Worker induction** = a third version per ⚑17, `version_kind = worker`, with its own three-task practical check. Same tables and ticks. Completion opens the ⚑15 gate for that worker.
- **Versions and re-ticks.** A material change to a module bumps that module's version and clears its tick for everyone, with the "what changed" note shown first. Annual re-tick per ⚑9.

---

## 6. Portal gaps the induction depends on

Each of these may already exist in some form. Step 0 reports which, and only the missing ones are built.

| Feature | Where | Behaviour |
|---|---|---|
| Worker logins | Account, contractor | Add a worker (name, mobile) → magic-link login with role `worker` under that contractor. Share and unshare jobs. Worker sees scope, standards links, photos and ticks; can add photos and tick surfaces (⚑13, ⚑14). RLS: a worker reads only jobs shared with them, never money columns, never another contractor's data. The old view-only work order link, if one exists, is no longer how workers are onboarded. |
| Ask a question | Job screen | Free text + optional photo → PC attention queue card with the job attached → reply appears in the job and as a notification (⚑11). |
| Change finish date | Job screen | New date + reason → PC confirms → existing customer messaging updates the customer and the walk-through booking (⚑12). Event-logged. |
| Request more materials | Materials section of the job | Item + quantity → PC card → reply shown in the job. |
| No work today | Already in the standards brief (R10) | Contractor can also raise it from the job: "Rained off / no work today" → PC confirms → day skipped. |
| Certificates later | Account set-up | "I will add this later" leaves the field empty with a reminder cadence; missing items listed on the painter's profile and in PC Command. |
| Google Calendar link | Calendar | Confirm it exists; if not, report and stop. It is not built as part of this brief without Tom's say. |

---

## 7. Server rules

1. Every write is a SECURITY DEFINER RPC with zod input. Robot actions are RPCs too, called by the job runner, never by the client.
2. `is_demo` rows are excluded by one shared scope used by every reporting and money query. A test proves a demo variation, invoice, expense and call back change no count anywhere.
3. A customer role can read nothing in the demo. A worker role reads only jobs shared with them, with no money column in any payload, proven by test on a real job and on the demo.
4. The DEMO text and every induction message go through the messaging adapter and are in the inventory.
5. Translations are data, loaded by a script, never hard-coded in components. A missing string falls back to English and is logged.
6. The induction completion record is reconstructable from events: language chosen, each tick, each practical task, completion, PDF sent.

---

## 8. Build order — copyable steps

One step per session. Gate green before moving on. Migrations between gates. E2e first, in the real role.

### Step 0 — Map the ground (no code)

    Read docs/briefs/claude-code-brief-induction-demo-property.md and
    docs/induction/induction-v1.md fully. Confirm the reference list
    (kickoff ritual). Write NO code. Report with paths:
    1. The standards sign-off as built from the standards brief: tables,
       screens, the offer gate.
    2. Whether these exist and where: any worker access to a work order
       today (the view-only link, what it shows), roles and RLS for a
       possible worker role, ask a question from a job, finish-date
       change, request materials, "no work today", Google Calendar link,
       expenses claim.
    3. How a job offer, booking confirmation, variation pricing, customer
       approval and invoice approval are performed today (which RPCs), so
       the robots can call the same ones.
    4. How the customer portal, PC Command, dashboard, payables and MYOB
       export read jobs, so one demo exclusion scope can sit under all of them.
    5. Any existing i18n or translation mechanism in the portal.
    6. Every place this brief's names differ from the code.
    Then STOP until Tom has read the report.

**Accept:** written map · every mismatch listed · no code changed.

### Step 1 — Demo scope and the seed

    Add is_demo to work_orders and every child table named in Step 0, and
    ONE shared scope that excludes demo rows from reporting, money,
    customer and PC Command queries. Build the 12 Demo Street template
    and the seed RPC that copies it to a contractor (and to a staff
    account). Build reset. Show the demo job under a "Demo" heading with
    a banner. No robots yet.
    E2e AS THE CONTRACTOR: demo job visible; AS PC: no demo row in any
    count, queue, dashboard or export; AS CUSTOMER: nothing.

**Accept:** seeding twice does not duplicate · reset restores the template exactly in one transaction · the exclusion is one scope, proven by a test that creates a demo variation, invoice, expense and call back and asserts every count is unchanged.

### Step 2 — The robots and the demo checklist

    Build the robot responses in §4.1 as server-side jobs calling the
    SAME RPCs a real PC, customer or office action uses, with the ⚑7
    delay. Build the demo checklist (§4.2 progress) and the staff live
    grid. Add the facilitator "Send demo prompt" button through the
    messaging adapter, wording "DEMO: " + the normal reminder text.
    E2e AS THE CONTRACTOR running every module's "On your phone" steps in
    order, with the robots answering; AS STAFF watching the grid fill.

**Accept:** every planted event in §4.1 resolves without a human · the variation reaches the demo invoice only after the contractor's Accept · the before-photo gate still blocks in the demo · the DEMO text is in the inventory and sends only from the button.

### Step 3a — Worker logins

    Build the worker role per §6 and ⚑13–⚑14: add a worker (name,
    mobile) → magic-link login under the contractor; share and unshare
    jobs; worker job view with scope, standards links, photos, surface
    ticks and photo upload; RLS so a worker reads only shared jobs and
    never a money column; PC list of every contractor's workers with
    induction state. Removing a worker revokes access at once.
    E2e AS A WORKER on a shared job (tick, photo, cannot see money or
    the status light), AS THE CONTRACTOR (add, share, remove), AS PC.

**Accept:** no money field in any worker payload, proven by test · a removed worker is locked out at once · a worker cannot reach another contractor's jobs · ticks by a worker are recorded against the worker and count for the contractor's job.

### Step 3b — Portal gaps

    Build only what Step 0 found missing from §6: ask a question,
    finish-date change, request materials, contractor-raised
    no-work-today, certificates-later. Each follows the existing patterns
    (queue cards, events, RLS three ways). Google Calendar: report only.
    E2e per feature AS THE CONTRACTOR and AS PC.

**Accept:** every new action makes exactly one queue card and one event · certificates-later leaves the gate closed and the reminder running.

### Step 4 — Language and induction content

    Build induction_modules / induction_blocks with per-language rows,
    the loader for docs/induction/induction-v1.md, and the translation
    file format (one file per language, same keys). Language choice
    screen, induction_language on the profile, fallback to English with
    a log line. Only the sign-off wording is translated (§5): the module
    text, the six standards sections, the tick statements and the PDF.
    The demo job, the app and the step names stay English. Produce the
    first-pass machine translations as files for Tom's team to test;
    languages ship OFF until staff set the live flag (⚑3).
    E2e AS THE CONTRACTOR in English and in one other language.

**Accept:** every block has an English row · a language that is not live is not offered · a missing string falls back to English and is logged · the demo job and every app screen are unchanged and English whatever language is chosen.

### Step 5 — Module ticks, practical check, completion, gate

    Extend the standards sign-off into the 13-module induction: one tick
    per module, Module 5 = the six standards ticks, resumable, the "On
    your phone" steps shown with their live demo-checklist state. Staff
    practical check (five tasks). Completion event + PDF in the chosen
    language, saved to documents and emailed. Update the offer gate per
    ⚑1. Build the refresher version (modules 3, 6, 7, 8, 9 + standards)
    and assign it to existing contractors, and the worker version per
    ⚑17 with its three-task check and the ⚑15 share gate. Version bump
    and re-tick per §5.
    E2e AS A NEW CONTRACTOR end to end: language → account without
    certificates → every module → practical check by staff → complete →
    offer still blocked → certificate uploaded → offer allowed. AS AN
    EXISTING CONTRACTOR: refresher → ticks → offers continue. AS A
    WORKER: worker induction on their own demo → complete → can now be
    shared onto a job; before completion the share is refused.

**Accept:** no offer before complete + check + insurance, enforced in the RPC · a worker cannot be shared onto a job before their induction is complete, enforced in the RPC · the PDF text equals the content the painter ticked, in their language · a material module change clears exactly that module's tick for everyone · the refresher never asks for the practical check.

### Step 6 — Hardening and the full room

    One e2e story with three contractors inducted at once by one
    facilitator: three demos running, three grids, one reset mid-session,
    one contractor ticking in Farsi while their demo stays English, one
    worker doing the worker induction on their own demo. Then
    the money story: prove again that nothing demo reaches payables,
    MYOB or the status evaluator. Update CLAUDE.md, ARCHITECTURE.md and
    the messaging inventory.

**Accept:** the room story green in CI · demo exclusion proven after all features exist · customer-role RLS denial for every new table.

---

## 9. Definition of done

1. A new contractor can finish the whole induction on a phone, ticking in their language, with an English demo job that answers itself, and nothing they did in the demo appears anywhere else.
2. Job offers are impossible until induction, practical check and insurance are all in, and that is enforced on the server.
3. Existing contractors complete the refresher with the same ticks, and every worker completes the worker induction on their own login before they can be put on a job.
4. Any contractor can reset their own demo; staff can see every contractor's progress live.
5. Every new message is in the messaging inventory; the DEMO text can only be sent by a facilitator.
6. All §3 defaults are Settings values; open ⚑s are listed in the final PR body for Tom.
7. Tom's five-minute check: on his phone, as a fresh contractor, he picks Italian and sees the tick wording in Italian, accepts the English demo job, raises the variation, watches it approve, signs the demo walk-through and resets.

## 10. Out of scope

- The induction deck itself (built from the doc, not code).
- Translating the in-app help base, any portal screen, the slides or the demo job (all stay English).
- Workers invoicing, raising variations or messaging customers or Paint Group (always the owner).
- A status light for workers (their work counts under their contractor).
- Building a Google Calendar link if none exists (report and stop).
- Any change to `lib/pricing`.
- Paying contractors for induction time (ruled unpaid).
- Call backs planted in the contractor's own demo (explained on the big screen only).

— End of brief. If anything here contradicts the standards brief on sign-off tables or the offer gate, the standards brief's tables stand and this brief extends them; report the contradiction either way.
