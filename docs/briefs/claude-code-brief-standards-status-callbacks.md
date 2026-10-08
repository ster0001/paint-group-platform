# Build Brief — Finish Standards, Painter Status (traffic light), Call Backs & PC Command Contractors

**Status:** ready to build once Step 0 has been reported back · written 7 October 2026
**Approved design:** `design/reference/contractor-status-standards-mockup.html` (Tom approved it on 7 Oct 2026: "I am happy with this"). Build to that mockup, not from memory of it.
**Approved content:** `docs/standards/finish-standards-v1.json` (the painter guide, Version 1, approved 6 Oct 2026; checked word for word against the source document).
**Builds on:** the existing contractor portal (scheduling + portal phases A–F), the work order loop and PC Command, the employed-painters extension, the messaging system, and invoicing. It adds to them. It does not replace any of them.

> **Written without repo access.** File paths, table names and column names below come from earlier briefs, not from the code. Step 0 exists to check every one of them against the repo before anything is built. Where the code disagrees with this brief, STOP and report. Do not guess and do not build a parallel version.

---

## 0. What this is, in plain English

Four things, built as one because each depends on the next:

1. **Finish standards.** The approved guide to Levels 2, 3 and 4 lives in the painter's app as data. Every painter confirms it once. Every surface on a work order links to the standard for that job's level.
2. **Call backs.** There is currently no way to log one. This adds one call back record with four ways in.
3. **Painter status.** A traffic light (Green, Yellow, Orange, Red, plus New in blue) worked out from three things the app already knows: quality checks, app updates and call backs.
4. **PC Command Contractors.** A new section showing every painter's light and numbers, with cards for rewards due and painters who need attention.

**How it fits the platform end to end:** the estimate sets the level → the work order carries it → the standard tells the painter what that level means on each surface → the quality check and walk-through judge against the same words → a failure that needs a return visit becomes a call back → call backs, checks and app updates set the painter's light → the light decides who gets offered work first, how fast they are paid and who is reviewed for a bonus → PC Command and the home dashboard read the same numbers.

---

## 1. Reference files — commit these first

    docs/briefs/claude-code-brief-standards-status-callbacks.md   (this file)
    design/reference/contractor-status-standards-mockup.html      (THE approved mockup, light + dark)
    docs/standards/finish-standards-v1.json                       (approved wording, structured)

Already in the repo, and required reading (paths to be confirmed in Step 0):

    CLAUDE.md                                                     (standards; STOP rule; e2e law)
    docs/ARCHITECTURE.md
    docs/briefs/claude-code-brief-wo-loop-pc-command.md           (stages, QA, walk-through, attention queue)
    docs/briefs/work-order-completion-workflow.md
    design/reference/pc-command-mockup.html                       (PC Command visual language)
    docs/briefs/claude-code-brief-employed-painters.md            (lead painter, employee differences)
    docs/briefs/messaging-automations-inventory.md                (every message the platform sends)
    docs/briefs/claude-code-brief-invoicing-payments.md           (contractor payment terms, chase ladder hold)
    docs/briefs/acceptance-to-paid-workflow.md
    docs/briefs/claude-code-brief-home-dashboard-v2.md            (Contractor section; Phase 0 data capture)

**Kickoff ritual (law):** commit the three new files, then confirm the full list back in the session before writing any code. If any file is missing: STOP and report. Do not reconstruct it from memory.

**What each reference is authoritative for:**

| File | Authoritative for | Not authoritative for |
|---|---|---|
| The mockup | Layout, screens, flows, wording of labels and buttons | Colour values, fonts, sample names and numbers, the wording of the standards themselves (the mockup shortens a few lines) |
| The standards JSON | Every word of the standards | Layout |
| This brief | Rules, data, build order, acceptance | Anything the code already does differently — report it |

---

## 2. Rulings (Tom, 6–7 Oct 2026) — settled, do not re-open

### Standards

| # | Ruling |
|---|---|
| S1 | The guide is approved as written, Version 1, **English only**. No translation in this build. |
| S2 | Standards are stored as **data, not a page**: one record per surface, per level, per check. Each surface maps to the substrate codes used by the rate card and work order lines. |
| S3 | Each surface line on a work order gets a **"What we expect"** link. It opens that surface at **that job's level only**. |
| S4 | Sign-off is **six sections, one tick per section. No typed name.** |
| S5 | **Every painter with a login must confirm**, including employed painters. |
| S6 | **No job offers until confirmed.** Existing contractors get it once, with reminder texts until they sign. |
| S7 | Each confirmation records who, when and which version, and shows on the painter's profile. A material change means a short "what changed" note and a new confirmation. Small wording fixes do not. |
| S8 | The painter can get back to the standards three ways: the Help tab, the link on each work order surface, and a PDF copy saved in their documents and emailed to them. |
| S9 | The tape defect step is **not required on jobs under 16 hours**. The work order shows "Tape check required" or "Tape check not required". |
| S10 | The "defects taped and fixed" tick on the completion checklist is **PAUSED. Do not build it.** |
| S11 | Bogging, Stain blocking and Additional coats are the named extra-time items, and become category chips when a painter raises a variation. |
| S12 | Quality checks use the same standards records, so the painter and the PC judge against the same words. |

### Call backs

| # | Ruling |
|---|---|
| C1 | A call back is **a return visit on another day to fix workmanship**. |
| C2 | Four ways to log one, all creating **the same record**: (1) a failed quality check asks "Can the contractor rectify today, or is it a call back?"; (2) a failed final walk-through asks the PC "Is a call back required?"; (3) a **"Customer called back"** button on the property in PC Command; (4) a **"Call back"** tick box in the scheduler, next to "Walk-through not required". |
| C3 | A walk-through that fails but is **fixed and signed the same day is a pass**, recorded as "passed after a fix". It is not a call back. |
| C4 | A quality check that fails but is fixed the same day is still a **failed check**. It is not a call back. |
| C5 | The PC picks a reason each time. **Only workmanship counts** against the painter. |
| C6 | A customer call back counts for **7 days after sign-off**. Later ones are logged against the painter but not scored. |
| C7 | A call back always counts against **the painter who did the job**, even if someone else fixes it. |
| C8 | The "Customer called back" route records the date and adds the return visit to the painter's scheduler. |
| C9 | In the Flow view, **Call backs is a column that appears only while a call back is open** and disappears when there are none. It is not a stage. The job card also carries a "Call back" tag. |
| C10 | An open call back **pauses invoice chasing and payment reminders** to the customer. They resume when it is closed. |
| C11 | Call backs **never hold or reduce the contractor's payment**. |

### Status and rewards

| # | Ruling |
|---|---|
| R1 | Three measures: quality checks passed first time, app reminders answered, call backs. |
| R2 | Five statuses: **Green, Yellow, Orange, Red**, and **New** (blue). |
| R3 | **Green = the last 4 jobs were all clean.** A painter who slips can win Green back with 4 clean jobs in a row. |
| R4 | Otherwise the colour comes from the last 10 jobs and **the worst measure decides**: Yellow = 80% or more on checks and reminders and no more than 1 call back; Orange = 50–79% on checks or reminders, or 2–3 call backs; Red = under 50%, or 4 or more call backs. |
| R5 | **New** lasts for the first 4 jobs. **Every existing contractor starts on New at launch.** A New painter must clearly see their steps to Green. |
| R6 | A job counts as clean only once its **7-day call back window has closed**. |
| R7 | **App updates are scored on the existing reminder moments only** (§4.2). The painter does not have to update every work day. Updating the same day they get the text counts. |
| R8 | Up to **three texts on the due day**. They stop the moment the update is in. |
| R9 | **"Above and beyond":** an update on a day with no reminder earns a credit, and a credit cancels one missed reminder. |
| R10 | The PC needs a **"No work today"** button so a rained-off day is not scored. |
| R11 | **Green gets:** priority on job offers, payment within **3 business days** of a signed walk-through, and bonus eligibility. A signed walk-through with every area approved is the "confirmed happy customer". The PC has a hold button for when a customer raises something (what it does: ⚑23). |
| R12 | **Yellow gets** normal offers and normal payment, with a quality check on 1 job in 3. **Orange:** offers come after Green and Yellow, a quality check on every job, and a call from the PC. **Red:** no new offers until they have spoken with Tom; jobs in progress finish. **New:** normal offers and payment, with a quality check on the first 3 jobs. |
| R13 | **Green painters are spot checked only when Paint Group chooses.** The PC has a "Spot check" button. |
| R14 | **Bonus:** starts at $500 and increases at Paint Group's discretion the longer a painter stays Green. It is **discreet**: painters see "Bonus eligible" and a "next bonus review" counter, never an amount and never a ladder. Tom sets the amount each time. |
| R15 | A bonus comes up for review **every 4 clean jobs of 16 hours or more while Green**. Jobs under 16 hours count for the colour but not for the bonus. |
| R16 | Rewards due appear as a card in PC Command for Felipe ("Tell Tom") **and** in the Contractors section. |
| R17 | **Employed painters:** only a lead painter sees the traffic light, and they are scored on the jobs they led. They can earn bonuses on Green. No employed painter sees priority jobs or fast payment. |
| R18 | The painter taps the light to see where they are, their progress, and **tips based on their score**. |
| R19 | Status is always shown **in words as well as colour**. The light pulses gently. No leaderboard. |
| R20 | **Reward only, never a deduction.** Lights, scores and bonus amounts are **never shown to customers**. |
| R21 | The Contractors section lives in **PC Command**. It shows painters by colour, open call backs, rewards due, standards not signed, and a row per painter. A card appears when anyone drops to Orange or Red. |
| R22 | Everything is available in **light and dark mode, in line with the current contractor portal**. |

**These rulings change three earlier decisions. Update the older briefs' notes when you touch that code:**

- WO loop decision 1 (quality checks: "established contractors none") → replaced by the cadence in R12–R13.
- Invoicing decision 8 (contractor paid 7 days after sign-off) → stays the default; Green at sign-off gets 3 business days.
- The Flow view has six stage lanes. This adds a seventh column that is **not a stage** and only shows when needed. The six-stage state machine is untouched.

---

## 3. Business decisions — ⚑ ASK TOM, do not invent

Build every one as a **Settings value with the stated default**, and list the open ones in the PR description so none ship silently.

| ⚑ | Decision | Default until Tom rules | Blocks |
|---|---|---|---|
| 1 | Existing contractors: how long after the invite before new offers stop | 7 days, then no new offers until signed. Jobs in progress unaffected. (Tom confirmed reminder texts; the cut-off was not explicitly confirmed.) | Launch to existing painters |
| 2 | Employed painters who have not signed | Reminders and a PC card only. No block on assigning them. | — |
| 3 | What counts as an "app update" | At least one surface tick or one photo on that work order | — |
| 4 | A day with two reminder moments (a 1-day job) | Each moment needs its own update. One update answers one moment. | — |
| 5 | Times of the 2nd and 3rd text | 7:30 am moment → 10:30 am and 1:30 pm. 3:30 pm moment → 5:30 pm and 7:00 pm. Nothing after 7:00 pm. | — |
| 6 | How credits apply | 1 credit per booked work day with an update and no reminder moment (no credit on a "No work today" day). A credit covers the oldest uncovered miss on the same job first, then on later jobs in sign-off order. Once applied it stays applied. An unused credit lapses when the job that earned it leaves the newest 10. | — |
| 7 | What "priority on new jobs" does | The scheduler's painter picker sorts Green first, then Yellow and New, then Orange, and shows each light. The PC still chooses. No automatic offers. | — |
| 8 | Red: how the block is lifted | The owner records "Spoken with, offers allowed" with a typed reason. It lasts until the painter's colour next changes. Event-logged. The same clearance is needed before a Red employed painter is set as lead on a new job. | — |
| 9 | What the bonus counter counts | Jobs that become clean while the painter is **already** Green, and are 16 hours or more. The four jobs that earned Green do not count. Resets to zero when the painter leaves Green. | — |
| 10 | Is $500 including or excluding GST for GST-registered contractors | **Not decided. Ask the accountant.** | **First bonus payment** |
| 11 | How an employed lead painter's bonus is paid | Recorded in the platform and added to the payroll CSV export. Not paid by the platform. Check with the accountant. | **First employee bonus** |
| 12 | Does the painter get a message when a bonus is approved | Yes: "A bonus has been added to your next payment." No amount in the message or on the status screen. | — |
| 13 | Who can see bonus amounts in PC Command | Owner and PC roles | — |
| 14 | Business days | Monday to Friday. Victorian public holidays as a Settings list. | — |
| 15 | Who can void a call back logged in error | PC can change the reason. Only the owner can void. Both event-logged with a reason. | — |
| 16 | Contractors with more than one login (crew) | Status belongs to the contractor account that accepts the offer. Crew logins do not see it. Every login still signs the standards. | — |
| 17 | Standards reminder cadence | Texts on days 2, 4 and 6 after the invite, 9:00 am. PC card on day 7. | — |
| 18 | New version of the standards | The painter sees the "what changed" note, then re-ticks all six sections. Same grace period as ⚑1. | — |
| 19 | Contractor agreement wording | The sign-off wording, the discretionary bonus and status-based payment terms need checking against the contractor agreement. Tom has agreed to have this checked. Not a code block. | Tom's call before launch |
| 20 | Example photos ("pass" / "not yet") per surface and level | Schema supports them. No photos in this build. Tom supplies later. | — |
| 21 | Painter-facing switch | `status_visible_to_painters`, default ON. Lets Tom run it staff-only first if he chooses. | — |
| 22 | Who closes a call back | The painter can mark it "Fixed" with a photo. The PC confirms and closes it. Only the PC's close ends the call back. | — |
| 23 | What the PC's payment hold does (R11 against C11) | It switches that job's payment from the Green 3 business days back to the normal terms, with a reason. It can **never** push payment later than the normal due date. | — |
| 24 | Small numbers | With fewer than 5 quality checks in the newest 10 jobs, band by failed checks, not percent: 0 or 1 failed → Yellow band, 2 → Orange, 3 or more → Red. Same for fewer than 5 scored reminder moments. Stops one failed spot check turning a Green painter Red. | — |
| 25 | Which jobs count at launch | Only jobs signed off on or after `status_launch_date` (Settings). Older jobs have no reminder or call back data and are never scored. | — |

---

## 4. Scoring rules — one evaluator, written once

All of this lives in **one module** (suggested `lib/painter-status/`), is pure and unit-tested, and is the only code allowed to decide a job result or a colour. PC Command, the painter app and the home dashboard all read its output. Nothing is computed in the browser.

### 4.1 Who is scored

- **Contractor:** the contractor account that accepted the work order offer.
- **Employed painter:** the lead painter on that job. An employed painter who has never led a job has no status at all.
- If two painters could be scored for one job, STOP and report. Do not split a job.

### 4.2 Reminder moments (existing schedule — do not redefine)

| Job length | Reminder moments (Melbourne time) |
|---|---|
| 1 day | Day 1 at 7:30 am, then 3:30 pm the same day |
| 2 days | Day 1 at 7:30 am, day 2 at 3:30 pm |
| 3 to 6 days | Day 1 at 7:30 am, half way at 3:30 pm, last day at 3:30 pm |
| 7 days or more | Day 1 at 7:30 am, 30% through at 3:30 pm, 60% through at 3:30 pm, last day at 3:30 pm |

This is what the messaging system sends today. **Read the schedule from the existing automation.** If the code disagrees with this table, STOP and report.

- A moment is **answered** when an app update (⚑3) lands on that work order on the moment's calendar day, Melbourne time.
- Follow-up texts (R8, ⚑5) are extra sends of the **same** moment. They stop as soon as it is answered.
- **"No work today"** (R10): the PC can set it for today or for a past day, with a reason. That day's moments are skipped and leave the count entirely, even if texts were already sent. An update on that day earns no credit.
- If the booking dates move, unanswered future moments are recalculated from the new dates. Rescheduling never changes a past moment.
- **Credits** (R9, ⚑6) are derived from the event log each time. They are never a stored balance.

### 4.3 Job result

**Terms used below.** *Finished* = the work order has reached `closed`. *Sign-off* = the signed walk-through time on the sign-off record. For a job marked "Walk-through not required", use the time it reached `closed` wherever this brief says sign-off (the 7-day window and the payment due date). Only jobs signed off on or after `status_launch_date` are scored (⚑25).

Each finished job has one result for the scored painter:

| Result | When |
|---|---|
| `not_clean` | Any slip: a quality check failed on its first attempt; a scored call back; or a reminder moment missed and not covered by a credit. On a job still in progress, slips are stored and the result is set when it closes. On a finished job (a customer call back inside the 7 days), the result flips at once. |
| `clean` | Sign-off + 7 days has passed with no slip. |
| `pending` | Closed, inside the 7 days, no slip yet. Pending jobs are not counted anywhere. |

- **Every call back, from any of the four routes, records a reason and a reported date.** Reason defaults to workmanship and the PC can change it. Reported date defaults to today.
- A call back is **scored** when reason = workmanship AND (it was reported before sign-off OR on or before sign-off day + 7).
- Walk-through "passed after a fix" (C3) is not a slip.
- Voiding a call back, changing its reason, or logging one late with a reported date inside the window recomputes the job result, even after the 7 days. A bonus already approved or paid is **never** taken back (R20). A bonus review not yet approved is flagged to the owner: "a qualifying job has changed".
- `counts_for_bonus` = the hours on the work order are 16 or more (`small_job_hours`, Settings).

### 4.4 Colour

Take the painter's resulted jobs (clean or not clean), newest first by sign-off date.

1. Fewer than 4 resulted jobs → **New**.
2. The 4 newest are all clean → **Green**.
3. Otherwise look at the newest 10 and band each measure. The worst band is the colour.

| Measure (newest 10 resulted jobs) | Yellow | Orange | Red |
|---|---|---|---|
| Quality checks passed first time ÷ checks done | 80% or more | 50% to 79% | under 50% |
| Reminders answered (credits applied) ÷ scored moments | 80% or more | 50% to 79% | under 50% |
| Scored call backs | 0 or 1 | 2 or 3 | 4 or more |

- A measure with nothing to measure (no checks done) is left out.
- With fewer than 5 checks, or fewer than 5 scored moments, band that measure by misses, not percent (⚑24).
- **Streak** = clean jobs in a row counting back from the newest. **Best streak** is kept for display.
- **Steps to Green** = the smaller of streak and 4, out of 4.
- **Bonus counter** = jobs with `counts_for_bonus` whose result became clean while the painter was already Green, since the last bonus review (⚑9). At 4, create one bonus review. Creating it must be idempotent.
- **Trend** (shown in PC Command) = the painter's colour now against their colour on the same date last month, read from the status-changed events: better, worse or the same.
- Recompute on: a job result changing, a call back being logged, voided or changed, a quality check result, a reminder moment closing, a job being signed off. Write a status-change event whenever the colour changes.

### 4.5 Quality check cadence by status (replaces "established contractors: none")

| Status | Checks |
|---|---|
| New | First 3 jobs (existing Settings default) |
| Green | None automatic. PC "Spot check" button on any job. |
| Yellow | 1 job in 3, auto-scheduled |
| Orange | Every job |
| Red | Every job still in progress |

### 4.6 Golden tests — twenty-four cases (write these before the evaluator)

| # | Case | Expect |
|---|---|---|
| 1 | 3 resulted jobs, one not clean | New |
| 2 | 4 resulted jobs, all clean | Green |
| 3 | Green painter; a customer call back (workmanship, day 3) on the newest job; no failed checks | Leaves Green at once; streak 0; Yellow |
| 4 | After case 3, four more clean jobs | Green, with the call back still inside the newest 10 |
| 5 | Call back with reason "not workmanship" | No change to result or colour |
| 6 | Customer call back reported on day 7 after sign-off / on day 8 | Scored / logged but not scored |
| 7 | Quality check fails, fixed the same day | Failed check; job not clean; no call back record |
| 8 | Walk-through flagged, fixed and signed the same day | "Passed after a fix"; job can still be clean |
| 9 | One missed moment, one credit on the same job / no credit | Clean / not clean |
| 10 | "No work today" on a moment's day | Moment skipped; not in the count; no credit for an update that day |
| 11 | 6 resulted jobs, newest not clean; checks 3 of 5; no call backs; reminders 100% | Orange |
| 12 | 6 resulted jobs, newest not clean; reminders 12 of 30; checks 100%; no call backs | Red |
| 13 | 6 resulted jobs, newest not clean; 2 scored call backs / 4 scored call backs; other measures 100% | Orange / Red |
| 14 | Clean job of 14 hours | Counts for streak and colour; not for the bonus counter |
| 15 | Bonus counter reaches 4, evaluator runs twice | Exactly one bonus review |
| 16 | Employed painter, lead on 4 clean jobs and crew on 6 others | Scored on the 4 only |
| 17 | Call back fixed by a different painter | Counts against the painter who did the job |
| 18 | Job closed 3 days ago, no slip | Pending; not in any count |
| 19 | Call back voided | Job result and colour recomputed |
| 20 | 6 resulted jobs, newest not clean because of one missed reminder; no quality checks at all; reminders 9 of 10 | Checks measure left out; Yellow |
| 21 | Job signed off the day before `status_launch_date` | Never scored; painter with only such jobs is New |
| 22 | Green painter; one spot check, failed, fixed the same day; it is the only check in the newest 10 | Yellow, not Red (⚑24) |
| 23 | A painter's first four jobs after becoming New are clean, then four more clean jobs of 16 hours or more | Green after the first four; bonus review after the second four, not the first |
| 24 | Workmanship call back logged on day 12 with a reported date of day 5 | Job flips to not clean; colour recomputed; any approved bonus untouched |

---

## 5. Data model (proposed — confirm names in Step 0)

Money in integer cents. Every table RLS'd three ways (staff, painter = own rows only, customer = **none of these tables**) with the explicit `view=` contract. Migrations run **between** gate runs; Tom pastes the SQL.

    standards_versions      version_no, title, published_at, published_by,
                            is_material, change_note, source_file
    standards_blocks        version_id, section_key (levels|rules|time|interior|
                            exterior|defect|checklist|words), body jsonb, sort
    standards_surfaces      version_id, side (interior|exterior), key, name, intro,
                            every_level, note, sort
    standards_checks        surface_id, level (2|3|4), label, text, sort
                            -- ONE ROW per surface, per level, per check (ruling S2)
    standards_surface_codes surface_id, substrate_code   -- many codes to one surface
    standards_acks          painter_user_id, version_id, section_key, acked_at
                            -- six rows = confirmed; unique per painter+version+section
    painters (existing)     + standards_invited_at
    wo_reminder_moments     wo_id, kind (day1|mid|p30|p60|last), due_at,
                            sends_count, last_sent_at, answered_at,
                            skipped_reason (no_work|rescheduled|null)
                            -- EXTEND the existing reminder record if one exists
    wo_day_flags            wo_id, day, flag (no_work), set_by, reason
    wo_callbacks            wo_id, painter_id (who did the job), fixed_by_painter_id,
                            source (qc_fail|walkthrough_fail|customer_call|scheduler),
                            reason (workmanship|not_workmanship), reported_on,
                            description, photo refs, booking_id (return visit),
                            status (open|booked|fixed|done|void), fixed_at,
                            closed_at, closed_by, void_reason, created_by
                            -- the home dashboard brief's Phase 0 already names
                            -- wo_callbacks: if it exists, EXTEND it
    wo_qa_checks (existing) + attempt_no (if not there), trigger
                            (new_painter|yellow_cadence|orange_every|spot),
                            fixed_same_day
    wo_walkthroughs / wo_signoff (existing)
                            + outcome (passed|passed_after_fix|failed_callback)
    painter_job_results     wo_id, painter_id, result (pending|clean|not_clean),
                            reasons jsonb, hours, counts_for_bonus, finalised_at
                            -- written ONLY by the evaluator
    painter_status          painter_id, colour, streak, best_streak, measures jsonb,
                            bonus_counter, computed_at   -- written ONLY by the evaluator
    painter_bonuses         painter_id, triggered_at, qualifying_wo_ids,
                            suggested_cents, amount_cents, status (due|with_owner|
                            approved|declined|paid), decided_by, decided_at,
                            payment_ref
    settings                + a key for every number in §2, §3 and §4

Events go to the **existing** event log. Do not create a second log. Log at least: standards confirmed; reminder moment answered, missed or skipped; "No work today" set; quality check result and attempt; walk-through outcome; call back logged, reason changed, booked, marked fixed, closed, voided; job result set or changed; status changed; bonus due, sent to owner, approved, declined; payment terms switched; Red clearance given. A painter's status must be rebuildable from these events.

**Seed file → tables.** The JSON holds each check once with `level_2`, `level_3` and `level_4`: the loader turns each into three `standards_checks` rows. The JSON's `substrate_code` is a placeholder and stays null: the mapping lives in `standards_surface_codes`. The JSON blocks are `levels`, `rules`, `time`, `defect_rule`, `final_checklist` and `words`; interior and exterior are an intro line each (plus `exterior_rules`) and the `surfaces` list. The six **sign-off** sections are in `sign_off_sections`; the final checklist is shown inside the sixth.

---

## 6. Server rules (non-negotiable)

1. Every write here is a **SECURITY DEFINER RPC with zod-validated input**. No client writes to result, colour, status, reason or money columns.
2. **Offers gate (S6):** the existing offer RPC rejects an offer to a painter who has not confirmed the current required version (after the ⚑1 grace period for existing painters). It also rejects an offer to a Red painter without an owner override (⚑8). The UI greys them out, but the rule lives in the RPC.
3. A painter can read **their own** status, job results and acknowledgements. Never another painter's. An approved bonus shows only as a line on that painter's own payment record. No bonus amount, counter target or history appears on any status screen.
4. **Customers can read none of this.** Prove it with RLS tests in the customer role, not by inspection.
5. Bonus amounts are set and approved server-side by the owner role. The approved bonus is a separate line on the contractor's payment, following the existing reimbursement-line pattern. It never passes through `lib/pricing`.
6. **Payment terms:** when a job is signed off, the contractor's due date uses the painter's colour **at that moment**: Green → 3 business days, otherwise the existing default. The PC's hold (R11, ⚑23) switches that one job back to the existing default terms, with a reason and an event. It can never push payment later than the default due date, and it is never a deduction.
7. **Chase hold (C10):** logging a call back sets the existing invoice `hold` on that job's customer invoices with kind `call_back`. Closing or voiding it clears that hold. Use the existing hold mechanism from the chase ladder. Do not build a second one.
8. Scheduled jobs (follow-up texts, standards reminders, job results finalising at 7 days) run on the **existing cron infrastructure** and are idempotent.
9. A call back never reopens a closed work order. It is a linked record with its own status.

---

## 7. Screens — build to the mockup

Open the mockup on a phone and in both themes before each UI step. The strip at the top of the mockup is a demo control, not part of the app.

**Painter app**

| Screen | What it must do |
|---|---|
| Home: status card | Traffic light with the lit lamp pulsing, status in words, one line on what it gets them, steps to Green when not Green. Tap opens My status. |
| My status | Light and reason line; steps to Green or streak; "What you get"; the three measures in plain counts ("5 of 5 passed first time"); last 10 jobs as dots (tick = clean, exclamation = not clean), tap a dot to see why; tips from the weakest measure; "How the colours work". New shows 4 job slots. |
| My status, employed lead painter | Same, labelled "jobs you led". No priority jobs or fast payment lines. |
| Standards | Confirmed date and version; Interior / Exterior surface grid; level switch on each surface; the rule pages (the three levels, rules for every job, your time and variations, the defect rule, final checklist, words we use). The mockup shows it as a bottom tab. If the portal already has a Help area, put it there and say so in the Step 0 report. |
| Work order | "What we expect" on every surface line → that surface at the job's level only, with "See other levels". Reminder moments for the job with their state. "Tape check required / not required". Extra time listed. |
| First-time sign-off | Intro, six sections, one tick each, Next disabled until ticked, resumable, then a confirmation screen. Full-screen until done when the gate applies. |

**PC Command**

| Screen | What it must do |
|---|---|
| Command queue | New cards per §8. Each has one primary action and clears itself when resolved. |
| Flow | A Call backs column only while one is open; "Call back" tag on the job card; "Invoice chasing paused" where it applies. |
| Contractors (new) | Counts by colour; open call backs, rewards due, not signed; one row per painter with light, checks, app, call backs, streak, trend against last month and tags; tap for the last 10 jobs, bonus history (staff only), Spot check and Log call back. |
| Property / job page | "Customer called back" button → date, what is wrong, photos, reason, return visit → saves and books. |
| Scheduler | "Call back" tick box beside "Walk-through not required". Ticking it links the visit to the finished job at that address. If a call back is already open there, the visit joins it. Never a second record. |
| Quality check | Recording Fail asks "Can the contractor rectify today, or is it a call back?" Each surface on the check screen links to the same standards record the painter sees, at the job's level (S12). |
| Call back card | Shows what is wrong, the return visit and the reason. The painter can mark it "Fixed" with a photo; the PC confirms and closes it (⚑22). |
| No work today | A button on a booked day (job page and scheduler). |

**In the mockup but not part of the app:** the strip at the top; "Replay the first-time sign-off"; the "Demo: open call backs" switch in Flow; and the PC tab called "Call backs". That tab only gathers the four routes onto one page to show them. In the build each route lives where it really happens: the quality check screen, the queue card and property page, the property page, and the scheduler. "Log call back" on a painter's row opens the route 3 form after the PC picks which of that painter's finished jobs it is for. It is not a fifth route.

**Required by this brief but not drawn in the mockup:** the reason and reported date on routes 1, 2 and 4 (the mockup shows them on route 3 only); marking a call back fixed and closing it; "No work today"; the payment terms switch (⚑23); the owner's bonus approval; the Red clearance (⚑8); voiding a call back; the "what changed" note for a new standards version. Build these in the same visual language and **send Tom a phone screenshot of each before merging.**

**The traffic light** has four lamps: red, orange, yellow, green, top to bottom. New lights none of them and shows a blue ring around the housing. Blue is used for the status word and for dots.

**Theme (R22):** use the contractor portal's existing theme switch and tokens. Do not copy colour values from the mockup; its light palette is a stand-in because the repo was not available. Add status tokens to the existing token file:

- Five **lamp** colours (green, yellow, orange, red, blue), the same in both themes, always shown inside the dark light housing or as a small dot.
- Five **text-safe** versions per theme for the status name, because yellow text on a white card is unreadable.
- Do **not** reuse amber, clay or emerald for lamps. Amber still means "waiting on a decision" and clay still means "overdue" everywhere else.
- Status is never colour alone: always the word, and the lamp's position in the housing.
- The pulse respects `prefers-reduced-motion` and is slow (about one cycle every two seconds).

**Wording for painters:** short sentences, common words, one idea per sentence. English is not their first language. Counts ("3 of 5"), not percentages, on the painter's screens.

---

## 8. Attention queue cards (extends WO loop §6.1 — same queue, same ranking)

| Trigger | Severity | Primary action |
|---|---|---|
| Final walk-through flagged an area | warning | "Is a call back required?" → No, fixed and signed today / Yes, call back (pick the return day) |
| Call back open with no return visit booked | warning | Book the visit |
| Call back visit is today or tomorrow | info | View job |
| Painter marked a call back "Fixed" | warning | Confirm and close |
| A qualifying job changed after a bonus review was raised | warning (owner) | Review |
| Painter dropped to Orange | critical | Open their score. Creates a "call them" task for the PC. |
| Painter dropped to Red | critical | Open their score. Also notifies the owner. |
| Bonus review due | info | "Tell Tom": marks it handed over. The owner is notified at the same moment the card appears, so it never depends on the PC remembering. |
| Standards not signed after the grace period | warning | Send reminder text |
| Payment hold on a Green painter's fast payment | warning | Release or keep |

Each trigger makes exactly one card and clears itself. Counts on the Contractors strip come from the same query as the cards.

**Home dashboard:** the Contractor section in `claude-code-brief-home-dashboard-v2.md` must read the same source as PC Command Contractors. Build the query once. If the dashboard section already exists, point it at this source and delete the duplicate.

---

## 9. Messages — all through the existing messaging system

Every message below is an automation in the existing system: wording editable in Settings, text or email selectable per automation (Tom's standing ruling), sent through the existing adapter. Add each one to `messaging-automations-inventory.md` in the same PR.

| # | To | When | Default wording (editable) |
|---|---|---|---|
| 1 | Existing painters | One time, at launch | "Paint Group: please read and confirm our finish standards. It takes about 10 minutes. [link]" |
| 2 | Painter not yet signed | ⚑17 cadence | "Reminder: confirm the Paint Group finish standards to keep getting job offers. [link]" |
| 3 | Painter | On confirming | Email with the PDF copy attached |
| 4 | Painter | New material version | "We updated the finish standards. Please read what changed and confirm. [link]" |
| 5 | Painter | 2nd and 3rd text for an unanswered reminder moment | 2nd: "Please update your job in the app today. [link]" 3rd: "Last reminder today. Please update your job in the app. [link]" 3rd for a Green painter (switched on in Step 6): "Update today to keep your Green. [link]" |
| 6 | Painter | Colour changed | Reached Green: "You are on Green. You now get priority on new jobs and faster payment." Dropped: "Your status is now [colour]. Open the app to see why and what to do next. [link]" |
| 7 | Painter | Call back booked | "Call back at [address] on [day]: [what is wrong]. [link]" |
| 8 | Painter | Bonus approved (⚑12) | "A bonus has been added to your next payment. Thank you for the clean work." |
| 9 | Owner | Bonus review due; painter dropped to Red | Direct notification as well as the PC card |

Message 6 for an employed lead painter leaves out priority jobs and faster payment.

---

## 10. Build order — copyable steps

One step per Claude Code session. Paste the block at session start. **Gate runs green before moving on. Migrations between gates. E2e first, in the real role.**

### Step 0 — Map the ground (no code)

    Read docs/briefs/claude-code-brief-standards-status-callbacks.md fully and
    confirm the reference file list back to me (kickoff ritual). Write NO code.
    Report, with file paths:
    1. Contractor portal: routes, layout, navigation, the theme switch and the
       token file for light and dark.
    2. Whether these exist and where: quality checks (pass/fail, attempt_no),
       final walk-through flags and sign-off, the scheduler's "Walk-through not
       required" tick box, PC Command Command/Flow views and the attention
       queue, the property/job page in PC Command.
    3. The contractor reminder automation: where the schedule in §4.2 lives,
       how sends are recorded, and what currently counts as an update.
    4. The lead painter flag on a job, and how employed painters are told apart.
    5. Whether wo_callbacks, painter status or standards tables already exist
       in any form (including from the home dashboard Phase 0 work).
    6. The contractor payment due-date logic and the invoice chase hold.
    7. The variation category list.
    8. Where a Standards entry best fits the portal's navigation.
    9. Every place this brief's names or assumptions differ from the code.
    Then STOP. Do not start Step 1 until Tom has read the report.

**Accept:** a written map with paths · every mismatch with this brief listed · no code changed.

### Step 1 — Standards as data + the help base

    Build §5 standards tables and a loader that seeds Version 1 from
    docs/standards/finish-standards-v1.json (one standards_checks row per
    surface, per level, per check: 159 rows). The loader is idempotent.
    Map each of the 17 surfaces to rate-card substrate codes in
    standards_surface_codes and give me the mapping as a table to approve;
    list every work order line code that maps to no surface.
    Build the Standards screens in the painter app per the mockup:
    Interior/Exterior grid, surface screen with level switch, the six
    rule sections (placed in the navigation as agreed from the Step 0 report).
    Add "What we expect" to each work order surface line: it
    opens that surface locked to the job's level, with "See other levels".
    A line with no mapped surface shows no link. Show "Tape check required /
    not required" from the work order hours and small_job_hours (default 16).
    Add Bogging, Stain blocking and Additional coats to the variation
    category chips if missing. Do NOT add any completion-checklist tick.
    On the PC's quality check screen, link each surface to the same
    standards record at the job's level (ruling S12).
    Light and dark via the portal's existing tokens.
    E2e AS THE PAINTER on a phone viewport, both themes.

**Accept:** seeded text equals the JSON exactly (a test diffs them) · 17 surfaces, 53 checks, 159 level rows · the work order link and the quality check link both open at the job's level, and the painter and the PC see the same record · unmapped lines show no link and appear in the report · no customer role can read any standards table.

### Step 2 — Sign-off, the offers gate and reminders

    Build the six-section sign-off per the mockup: one tick per section,
    stored per section with timestamp and version, resumable, no typed name.
    Six ticks = confirmed: write the event, generate the PDF copy server-side
    from the same data, save it to the painter's documents and email it.
    New painters: sign-off is a required onboarding step. Existing painters:
    a one-time invite (message 1), reminders per ⚑17, full-screen prompt on
    next login. Enforce the offers gate in the existing offer RPC (§6 rule 2) with
    the ⚑1 grace period as a Settings value; grey out unsigned painters in
    the scheduler picker with "Standards not signed". Employed painters: ⚑2.
    Show confirmed date and version on the painter's profile and on the
    existing staff painters list (the Contractors section arrives in Step 8).
    Add the "Standards not signed after the grace period" trigger to the
    existing attention queue in this step. Publishing a material new version
    requires a new confirmation with the change note shown first.
    E2e AS A NEW PAINTER (blocked from offers until confirmed), AS AN
    EXISTING PAINTER (invite → reminders → confirm), and AS PC (sees who has
    and has not signed; cannot offer past the grace period).

**Accept:** an offer to an unsigned painter fails at the RPC, not just in the UI · six acknowledgement rows per confirmed painter, each with a version · the PDF text matches the seeded data · reminders stop the moment the painter confirms · jobs in progress are untouched by the gate.

### Step 3 — Call backs: one record, four ways in

    Build wo_callbacks (or extend it if it exists) and the lifecycle
    open → booked → fixed (painter, with a photo) → done (PC confirms and
    closes, ⚑22), plus void (⚑15). EVERY route records a reason (default
    workmanship, PC can change it) and a reported date (default today); the
    mockup shows these on route 3 only. Build the four routes per rulings
    C2–C8 and the mockup:
    (1) Recording a quality check Fail asks "Can the contractor rectify today,
        or is it a call back?" Fixed today = failed check, no call back.
    (2) A flagged area in the final walk-through creates a PC queue card,
        and the same question on the property/job page: "Is a call back
        required?" If the job is fixed and signed the same day, record
        outcome passed_after_fix. If it is not signed by the end of that
        day, the card becomes critical.
    (3) "Customer called back" on the property/job page: date, what is wrong,
        photos, reason, return visit → creates the record and the scheduler
        booking for the painter who did the job.
    (4) "Call back" tick box in the scheduler beside "Walk-through not
        required": links the visit to the finished job at that address; if a
        call back is already open there, attach to it.
    Flow view: Call backs column only while one is open; "Call back" tag on
    job cards. Set and clear the customer invoice chase hold (§6 rule 7).
    Never reopen a closed work order. Never touch contractor payment.
    E2e AS PC for each of the four routes, and AS THE PAINTER (sees the
    booked return visit and what is wrong).

**Accept:** all four routes produce the same record type, each with a reason and a reported date · route 4 on an address with an open call back creates no second record · a call back can be taken from logged to closed in the e2e, and only the PC's close ends it · the column is absent from the DOM when no call back is open · invoice chasing pauses on log and resumes on close, proven against the existing ladder · the record names the painter who did the job even when another painter is booked to fix it.

### Step 4 — Reminder moments, follow-up texts and credits

    Extend the EXISTING contractor reminder automation (do not build a second
    scheduler): record each moment in §4.2 per work order, mark it answered
    by an app update on its day (⚑3, ⚑4), send up to three texts on the day
    at the ⚑5 times and stop once answered. Add the PC "No work today" button
    (job page and scheduler) that skips that day's moments. Recalculate
    future moments when booking dates move. Show the job's moments and their
    state on the painter's work order screen per the mockup. The third text
    uses the general wording in message 5; the Green wording is switched on
    in Step 6, once status exists. Add the new sends to
    messaging-automations-inventory.md with editable wording.
    E2e AS THE PAINTER (update after the first text → no second text) and
    AS PC (No work today → no text, moment skipped).

**Accept:** no text is sent after a moment is answered · never more than three texts per moment · nothing sent after 7:00 pm · a skipped day's moments are absent from every count, including a day skipped after its texts went out · the schedule matches §4.2 for 1, 2, 5 and 9 day jobs in tests.

### Step 5 — The evaluator

    Write the §4.6 golden tests first, all twenty-four, failing. Then build
    lib/painter-status as pure functions plus one RPC that writes
    painter_job_results and painter_status (nothing else may write them).
    Create painter_bonuses here too, with the idempotent "raise one bonus
    review" call the evaluator makes at a counter of 4; the approval flow
    comes in Step 7. Score only jobs signed off on or after
    status_launch_date (⚑25). Write every event listed in §5.
    Finalise job results at sign-off + 7 days on the existing cron
    infrastructure. Recompute on every trigger in §4.4 and write a
    status-changed event when the colour changes. Seed every existing painter
    as New at launch. Apply the quality check cadence in §4.5 to the existing
    QA scheduling, and add the PC "Spot check" action to the existing
    quality check scheduling screen.
    No other UI in this step beyond a plain staff-only table to inspect
    results.

**Accept:** all twenty-four golden tests green · running the evaluator twice changes nothing · no browser code computes a result, a colour or a count · a test rebuilds a painter's status from the event log alone and gets the same answer · employed painters with no led jobs have no status row · no job signed off before the launch date appears in any count.

### Step 6 — The painter's traffic light

    Build the Home status card and My status per the mockup, for all five
    statuses, for contractors and for employed lead painters (R17), in light
    and dark. Everything on screen is read from painter_status and
    painter_job_results. Tips come from a small copy table keyed by weakest
    measure and status. Add the status tokens per §7 to the portal's token
    file. Send message 6 on a colour change, and switch on the Green wording
    of the third reminder text (message 5). Honour the
    status_visible_to_painters switch.
    E2e AS A PAINTER in each of the five statuses, and AS AN EMPLOYED LEAD.

**Accept:** no bonus amount anywhere in the painter's app · status shown in words on every screen that shows a lamp · a non-lead employed painter sees no status UI at all · pulse stops under reduced motion · visual match with the mockup on a phone in both themes.

### Step 7 — What the colour changes: offers, payment, bonus

    Scheduler painter picker: sort and show lights per ⚑7; block Red in the
    offer RPC until the owner's clearance (⚑8), and block a Red employed
    painter from being set as lead the same way. Contractor payment due
    date: Green at sign-off → 3 business days (⚑14); the PC's hold switches
    that job back to the default terms and never later (§6 rule 6, ⚑23).
    Bonus: when the evaluator raises a review (due), show the PC card and
    notify the owner at the same moment; "Tell Tom" marks it handed over;
    the owner sets the amount (prefilled with the painter's last bonus, or
    the Settings default of $500) and approves or declines; approved adds a
    separate "Bonus" line to the contractor's next payment, or to the payroll
    export for an employed lead. Do not pay any bonus until ⚑10 and ⚑11 are
    answered: ship with the approve action behind a Settings switch, OFF.
    E2e AS PC and AS OWNER for one bonus from due to approved.

**Accept:** an offer to a Red painter fails at the RPC without the owner's clearance · a Green painter's due date is exactly 3 business days after sign-off across a weekend in tests · a held payment's due date equals the default terms, never later · one bonus row per four qualifying jobs, never two · bonus approval is impossible while the switch is off · a painter can read a bonus amount only as a line on their own payment record, and a customer role can read nothing · an approved bonus survives a later change to a qualifying job.

### Step 8 — PC Command Contractors + queue cards

    Build the Contractors section per the mockup and the queue cards in §8,
    on the existing attention queue. Counts on the strip and the cards come
    from one query. Point the home dashboard's Contractor section at the same
    source. Every number is read from the model.
    E2e AS PC: each card's action lands in the right place and the card
    clears when resolved.

**Accept:** every §8 trigger produces exactly one card · strip counts equal the list · the dashboard and PC Command show the same numbers from the same query · visual match with the mockup on a phone in both themes.

### Step 9 — Hardening and the full loop

    One e2e story across painter, PC, owner and customer roles: new painter
    signs the standards → gets an offer → answers reminders → passes checks →
    signed walk-through → 7 days pass → clean job, four times → Green →
    priority in the picker and a 3-business-day due date → four qualifying
    jobs → bonus review. Then the failure story: quality check fails and is
    fixed the same day; a walk-through is flagged and needs a return visit;
    a customer calls back on day 5 and another on day 9. Check the colour at
    each point against §4. Prove the customer role sees none of it.
    Update CLAUDE.md, ARCHITECTURE.md and the messaging inventory.

**Accept:** both stories green in CI · customer-role RLS denial tests for every new table · greps clean for client-side writes to result, colour, status or money columns.

---

## 11. Definition of done

1. A painter cannot be offered work without having confirmed the current standards, and that is enforced on the server.
2. Every work order surface with a mapped standard opens the right surface at the job's level, in the painter's own theme.
3. There is exactly one call back record type, reachable four ways, and the Flow column appears and disappears with it.
4. A painter's colour can be rebuilt from the event log alone, and all twenty-four golden tests pass.
5. PC Command, the painter app and the home dashboard show the same numbers from one source.
6. Nothing about status, scores or bonuses is readable in the customer role.
7. Every number in §2–§4 is a Settings value. The open ⚑s are listed in the final PR body, addressed to Tom.
8. Every new message is in the messaging inventory with editable wording.
9. Tom's two-minute check, on his phone, in both themes: as a painter he sees his light, taps in, sees why, and opens a surface standard from a job; as PC he logs a customer call back and watches the column appear.

## 12. Rollout (Tom, not code)

1. Tom tells the contractors first, by message or a call to the main crews, before anything appears in the app.
2. Two or three trusted contractors go through the sign-off first. Fix any wording that confuses them.
3. Everyone else gets the invite (message 1). Everyone starts on New.
4. Before painters see rewards, settle ⚑10, ⚑11 and ⚑19.

## 13. Out of scope

- Translation of the standards (parked by Tom).
- The "defects taped and fixed" completion-checklist tick (paused by Tom).
- Example photos for the standards (schema only; ⚑20).
- An in-app editor for the standards. New versions arrive as a new seed file.
- Customer-facing wording from the same records ("What we'll do" panel, completion report). The schema must not prevent it.
- Any change to `lib/pricing`. If a diff touches pricing, stop and report.
- Deductions, penalties or payment holds caused by status or call backs.
- A leaderboard or any view where one painter sees another's score.

— End of brief. If anything here contradicts the work order loop workflow for stages, that file wins. If anything contradicts the code, report it before building.
