# Contractor induction, demo property & language — Step 0 report (map the ground, no code)

Run 14 Oct 2026 against `docs/briefs/claude-code-brief-induction-demo-property.md` §8 Step 0. Nothing in `app/`, `lib/` or `supabase/` was changed. Paths are repo-relative; `20270230:147` means `supabase/migrations/20270230000000_status_offers_payment_bonus.sql` line 147.

**Kickoff ritual.** Every file in the brief's §1 is present (checked 13 Oct, `docs/briefs/standards-status-callbacks-s0-report-2026-10-13.md` §1). The companion map of the standards build as shipped is that file; this one does not repeat it.

**Headline.** Of the four things the brief builds, the ground is: the sign-off exists and is one version with six sections (extendable); there is **no worker/crew login of any kind** (one auth user per contractor, `contractors.profile_id unique`); **no i18n of any kind**; **no demo/sample flag on any table** and no shared job loader to hang one on (58 files query `work_orders` directly); **no delayed-job runner faster than 5 minutes**; and the robots cannot act as the office through the service-role key, because `is_staff()` is `profiles.role='staff'` for `auth.uid()`. Three of the seven §6 "portal gaps" exist already (ask a question, finish-date change, expenses, Google Calendar); three do not (request materials, contractor-raised no-work-today, certificates-later).

---

## 1. The standards sign-off as built (tables, screens, offer gate)

| Piece | Where |
|---|---|
| Versions / content | `standards_versions`, `standards_blocks`, `standards_surfaces`, `standards_checks`, `standards_surface_codes` — `20270224000000_finish_standards.sql`. Loader `scripts/seed-standards.ts` reads `docs/standards/finish-standards-v1.json` (English only; the JSON's `"language":"en"` field is typed in `lib/standards/source.ts:25` but unused). |
| Ticks | `standards_acks(painter_user_id, version_id, section_key, acked_at)` — `20270225000000_standards_signoff.sql:33`, unique per painter+version+section. RPC `standards_ack_section` (:140). Six sections = `SIGN_SECTIONS` in `lib/standards/acks.ts:52`. |
| Status | `standards_status_of()` (:88) → `not_required | confirmed | employee_unsigned | not_invited | grace | blocked`; TS mirror `standardsStatusOf` in `lib/standards/acks.ts`. Grace = `settings.standards_rules.graceDays` (7). `contractors.standards_invited_at / standards_grace_until` (:30–31). |
| Screens | `app/portal/standards/confirm/page.tsx` (+ `SignoffStep.tsx`, `actions.ts`): intro → `?s=<section>` one at a time → `?done=1`. Resumable, full-screen (tab bar hidden, `PortalTabs.tsx:40`). Home redirects there when `blocked` (`app/portal/page.tsx:61`). Reading screens under Help: `app/portal/help/standards/…`; staff mirror `app/pc/standards/…`. |
| PDF + email | `lib/standards/pdfHtml.ts`, `lib/standards/notify.ts` (automation `contractor_standards_confirmed`). |
| Versioning | `standards_publish_version` (:196), `is_material` + `change_note` on `standards_versions`; a material version re-invites. |
| Offer gate | `send_offer` (`20270230:147`): staff → issued → active → `offerable` (insurance) → `standards_status_of = 'blocked'` → `error:standards_not_signed` (:165) → `painter_offers_blocked` → `error:red_no_clearance` (:167). Trigger `booking_offers_standards_gate` (:189) re-checks on every `booking_offers` insert. `assign_job` (`20270154:186`) is the no-offer path; `set_lead_painter` has the Red gate (`20270230:204`). |
| Insurance part of the gate | `contractor_recompute_offerable()` (`20260831000000_compliance_hardening.sql:59–75`): `offerable` = a verified, unexpired `insurance` document. **WorkCover is never a gate** (⚑1 default wants it when `workers > 1`). |

**What the induction extends:** `standards_acks` stays as the Module 5 ticks. `induction_modules / induction_blocks / induction_acks / induction_checks` are new. `standards_status_of` becomes one input to an induction status, and the gate in `send_offer` gains "induction complete + practical check" (⚑1).

## 2. Do these exist, and where

| Feature | Exists? | Where / what it does today |
|---|---|---|
| **Worker access to a work order** | View-only link only | `work_orders.crew_token` (`20261027000000_wo_crew_link.sql`), minted by `get_or_create_crew_token` (lead or staff), read by anon RPCs `get_work_order_by_crew_token` etc. Page `app/crew/[token]/page.tsx` renders `WorkOrderDoc variant="crew"` through the server whitelist `lib/workorder/crew.ts` (no pay, `contactPhone` blanked, materials/colours/notes kept). **Crew cannot tick or upload; no identity; no attribution.** Shared by hand from `app/portal/jobs/[id]/CrewShare.tsx`. `contractors.crew_size` is a capacity number only. |
| **A worker role / RLS** | None | `profiles.role` enum `staff | customer | contractor` (`initial_schema.sql:19`); `staff_roles[]` enum `owner|admin|pc|sales|finance`. `contractors.employment_type` is explicitly "not a fourth auth role". `contractors.profile_id` is **unique** → one login per contractor; no table links several auth users to one contractor. Nearest pattern to copy: `account_users` (customer/trade orgs, roles `owner|member|admin|approver|viewer|finance`, `20261128…:67`, invites `lib/portal/teamInvite.ts`). RLS helpers: `is_staff()`, `current_contractor_id()`, `wo_painter_on_job(wo, contractor)` (`20270159:20`), `wo_is_my_job_as_customer`, private view `wo_visible_jobs` (`20270201:48`, used only inside policies). Magic-link login exists for customers: `lib/portal/auth.ts:66 sendMagicLink` → `/account/auth` (button+POST since 13 Oct), `homeForRole` in `app/auth/actions.ts:23`. |
| **Ask a question from a job** | **Yes** (labelled "Messages") | `20270249000000_wo_painter_messages.sql`: `wo_message_threads` (one per WO+contractor), `wo_messages`, bucket `wo-messages`; RPCs `wo_message_post`, `wo_message_post_from`, `wo_message_mark_read`, `wo_my_message_threads`. Portal `app/portal/jobs/[id]/page.tsx:783` `<MessageThread mode="painter">`; PC `app/pc/wo/[id]/page.tsx:633`. Queue kind `painter_message` (`lib/crm/work-queue.ts:152`, builder ~:2293), card on `/pc` (`app/pc/page.tsx:288`). Notifications `office_painter_message`, `contractor_message`. Replies show in the same thread. ⚑11 is already true. |
| **Finish-date change** | **Yes**, with a hole | `app/portal/jobs/[id]/FinishDate.tsx` → `setFinishDate` (`tickActions.ts:274`) → RPC `wo_contractor_set_finish_date` (`20261222…:10`): lead or staff; updates `booking_offers.end_date` + `work_orders.end_date`, re-books the final walk-through on the new day, logs `finish_date_changed`, re-sends `walkthrough_invite` to customer + painter. **No "reason" field; no PC confirm step** (⚑12 says PC confirms). **Hidden when walk-through not required**, and then no customer notice at all. Start-date change is a separate request flow (`request_reschedule` → staff `resolve_proposed_offer`). |
| **Request more materials** | **No** | No action, no `*Materials*` component under `app/portal/jobs/[id]/`. Materials are read-only in `app/w/WorkOrderDoc.tsx:211–250`; `wo_set_material` is staff-only. Nearest: expense category `materials_topup` + `expense_preapproval_request`, and the Messages box. |
| **"No work today" raised by the contractor** | **No** | `wo_set_no_work_day` / `wo_clear_no_work_day` (`20270227:109`) return `error:not_staff`. Portal only displays it (`app/portal/jobs/[id]/UpdateMoments.tsx:27`). Employee "Can't make it" (`assignment_cant_make_it`) is reassignment, not rain. |
| **Google Calendar link** | **Yes** — report only | `contractor_gcal_connections / contractor_gcal_events` (`20261201000000_gcal_sync.sql`), routes `app/api/gcal/{connect,callback,sync,webhook}`, cron `gcal-sweep` */5. Push-only into a "Paint Group Jobs" calendar (`calendar.app.created`); contractor busy time is **not** read. UI `app/portal/calendar/GoogleSyncCard.tsx`, shown to `acceptsOffers` only (not employees). Block-out days: `contractor_unavailability` (`20260827…`), direct insert from `CalendarGrid.tsx:121–182`. Module 12's two steps both exist. |
| **Expenses claim** | **Yes** | `20261127000000_contractor_expenses.sql`: `contractor_expenses` (receipt **required**, `over_threshold_unapproved` flag), `expense_preapprovals`. Threshold `cost_intake.expenseThresholdCents` = 10000 ($100); categories `materials_topup, sundries, parking, tip_fees, other`. RPCs `contractor_expense_submit` (latest `20270161:201`), `contractor_expense_decide` (staff), `expense_preapproval_request/decide`. UI `app/portal/money/Expenses.tsx`, `expenseActions.ts`. Module 11's "$20, Parking" works today. |
| **Certificates later** | **No explicit step** | `app/join/[token]/JoinForm.tsx` collects name/mobile/password only and goes to `/portal`. No upload at join, no "I will add this later" flag — deferral is implicit (`offerable` stays false). Upload lives in `app/portal/profile/ProfileForm.tsx:629–650` (`contractor_documents`, kinds `insurance|workcover|licence|other|white_card|working_at_heights|standards`, `verified_at`). Reminders are **in-portal only** (`app/portal/page.tsx:140–165`); **no SMS/email reminder for missing or expiring certificates exists** in `lib/automations/registry.ts`. |

## 3. The RPCs the robots must call (same ones a human uses)

**The approach-deciding fact:** `is_staff()` checks `profiles.role='staff'` for `auth.uid()`; a service-role client has `auth.uid() = null`, so nearly every office RPC answers `error:not_staff` to it (CLAUDE.md already warns of this). Customer-token RPCs are granted to `anon` and need only the token. So the robot acts as the customer with the demo job's tokens, and as the office it needs **a real staff session** (a dedicated "Paint Group robot" staff profile; session-creation precedent in `scripts/create-test-contractors.ts`, `lib/portal/auth.ts`). Side effects (texts, emails, pings) mostly live in the **server actions**, not the RPCs — a robot calling the RPC alone skips them.

| Planted step (§4.1) | RPC(s) | Latest def | Gate | Human caller |
|---|---|---|---|---|
| Offer sits at `offered` | `send_offer(wo, contractor, start, end, note)` | `20270230:147` | staff + standards + Red gates | `app/pc/schedule/actions.ts:166` |
| Contractor accepts | `respond_to_offer(offer_id, 'accept'…)` | `20260828…:150` | **contractor only, no staff branch**; expired → `error:expired` | browser: `app/portal/requests/OfferCard.tsx:80`, `jobs/[id]/OfferBar.tsx:44` |
| Booking confirmed | trigger `wo_stage_follows_offer` → `pre_start` (`20261011:55`); QA placed by `booking_offers_qa_at_booking` (`20270247:157`); **confirmation is not an RPC** — client calls `pingAppointmentConfirm` → `app/api/appointments/confirm/route.ts` → `sendAppointmentConfirmation` (`lib/workorder/appointmentEmail.ts:23`), backstopped by wo-sweep | | | |
| Variation raised | `wo_raise_variation(wo, category, comment, photo_ids[], est_hours)` — ≥1 photo | `20270158:29` | contractor on job or staff | `variationActions.ts:114` |
| Priced | `wo_price_variation(id, price_cents, inputs, priced_lines, hours) → 'ok:<customer_token>'` | `20261002:111` | staff | `app/quote/variationActions.ts:69`, then `sendVariationForSignatureAction` |
| Customer approves | `wo_customer_sign_variation(token, name, signature_png)` — with a painter on the job it sets `released_at` and waits at `customer_approved` | `20270253:72` | **anon/token** | `app/v/[token]/actions.ts:34` |
| Contractor Accept | `wo_contractor_accept_variation(id)` — needs `customer_approved` + `released_at` | `20261219:16` | contractor or staff | `variationActions.ts:174` |
| On the demo invoice | `contractor_invoice_amounts(wo)` adds `contractor_delta_cents` for `contractor_accepted` rows; `contractor_invoice_draft(wo)` (**service_role only**, `20270230:270`) is run by the sign-off tails | | | |
| Walk-through start | `wo_contractor_finish(wo)` → `completion_prep` (needs a completion photo, `20270215:56`); `wo_start_walkthrough_mode(wo)` → 2h session token on `/s/[token]` (`20270161:293`) | | lead/painter on job | `tickActions.ts:234`, `:136` |
| Customer flags Hallway walls | `wo_walkthrough_area(token, area, approve=false, note)` → rectification row, stage → `in_progress` | `20270164:34` | anon/token | `app/s/[token]/actions.ts:27` |
| "Fixed" → walk again | `wo_complete_after_rectification(wo)` runs `in_progress → … → closed` and signs as `rectified` **in one go** — it does **not** stop for a second walk-through | `20270162:29` | staff or contractor | `tickActions.ts:162` |
| Sign | `wo_sign_drawn(token, png)` → `wo_sign` → `closed`, drafts both invoices; `error:areas_outstanding` / `walkthrough_first` | `20270202:154/:31` | anon/token | `app/s/[token]/actions.ts:49` |
| Start job / before-photo gate / stages | `wo_contractor_start(wo)` (**contractor only**, `20261124:40`); `wo_tick_surface(surface_id, 'todo'|'prepped'|'done')` with `error:before_photo_required:job` unless `wo_has_job_photo(wo,'before')` (`20270207:35`); photos via `app/api/wo/photos/route.ts` → `wo_record_photo` (`20270159:110`) | | painter on job or staff | `app/components/wo/tickAction.ts:31`, `BatchUploader.tsx` |
| Invoice submit → approve | `contractor_invoice_submit(id)` (contractor; needs profile + **bank details**), `contractor_invoice_approve(id)` (staff), `contractor_invoice_mark_paid` | `20270218:280/:354`, `20261127:470` | | `app/portal/money/actions.ts:27`, `app/invoicing/actions.ts:558` |
| Expense submit → approve | `contractor_expense_submit`, `contractor_expense_decide(id, approve)` | `20270161:201`, `20261127:218` | | `expenseActions.ts:40`, `invoicing/actions.ts:718` |
| DEMO text | **No single-moment send exists.** The per-moment send is inline in `runJobReminderSweep` (`lib/automations/sweeps/jobReminders.ts:225–269`), only called by `campaign-sweep`. A facilitator button needs a `sendMomentText(db, woId)` extracted from it, through `sendAutomation` (`lib/automations/dispatch.ts:118`) | | | |
| Answering the prompt | trigger `wo_reminder_moment_answer` counts only `actor_kind contractor|system` events on the moment's day (`20270227:84`) — a staff robot tick does **not** answer it | | | |

**Delay infrastructure (⚑7 "reply in 5 s"):** crons in `vercel.json` — fastest is `gcal-sweep` every 5 min; no pg_cron/pg_net, no queue table. `automation_holds.release_at` (`20270150…:19`) is the only time-based release and runs on the 30-min sweeps. The one in-request delay precedent is `after(async () => { await setTimeout(…) })` in `app/invoicing/actions.ts:573` (`payCiQuickAction`), bounded by the function's `maxDuration`. So "5 seconds" is only reachable as an `after()` inside the server action the contractor just called — which also answers "the robots run server-side".

## 4. How jobs are read, so one demo-exclusion scope can sit under all of them

**There is no shared loader to put it under.** No TS loader is common to the screens; ~58 non-test files call `.from("work_orders")` directly. The only view, `private.wo_visible_jobs`, returns ids for RLS and is read by no app code. The nearest existing exclusion is `estimates.reporting_excluded_at` (`20270184…`, `lib/reporting/exclusions.ts`) — applied **only** by the `/home` dashboard (`lib/reporting/load.ts:492–526`), not by `/pc`, `/pc/schedule`, `/pc/contractors`, `/invoicing`, the work queue or the status evaluator, despite its migration header saying otherwise.

| Surface | Reader | Reads `work_orders` |
|---|---|---|
| Customer portal | `lib/portal/data.ts` (`getPortalJobs:119`, `getPortalProject:225`, `getPortalAftercare:383`), `lib/portal/tradeData.ts` | directly (service client, filtered by customer) |
| Token pages | `/e` `get_estimate_by_token`; `/s` `wo_walkthrough_by_token` + `wo_signoff`; `/v` `wo_variation_by_token`; `/i` `invoice_by_token`; `/w` `get_work_order_by_token`; `/crew` crew-token RPCs | RPC per token |
| PC Command | `loadConsole` (`lib/workorder/consoleData.ts:31`, used by `/pc`, `/pc/flow`, home), `buildPcWorkItems` readers (`work-queue.ts:1877, 2061, 2168, 2244, 2311, 2386`), `loadBoard` (`lib/scheduling/board.ts:206`), `loadContractorsView` (`contractorsLoad.ts:13`), `app/pc/updates/page.tsx:17`, `app/pc/api/search/route.ts:49` | directly, each |
| Home dashboard | `loadDashboard` (`lib/reporting/load.ts:472`) → `loadClosedJobs`, `loadContractorSlice`, `loadInvoicingSlice`, plus `loadConsole` and `loadContractorsView` | directly; the only place `reporting_excluded_at` applies |
| Payables / Payments | `app/invoicing/jobMoneyData.ts:45 loadJobMoneyInput` (→ pure `jobMoney.ts`), `app/invoicing/data.ts` (`loadJobMoney:349` via RPC `invoice_ledger_staff`, `loadExpenseQueues:199`), portal `app/portal/money/page.tsx:54,62` | directly |
| MYOB export | **Does not exist.** `lib/myob/*` is OAuth + settings only. Payroll CSV `app/pc/timesheets/export/route.ts:37` (timesheets ⋈ work_orders, + `painter_bonuses`). Metrics CSV `app/api/reporting/export` goes through `loadDashboard`. |
| Status evaluator | `lib/painterStatus/run.ts:48 loadPainterFacts` — closed `work_orders` by contractor (:62) + signoff/qa/moments/callbacks/day_flags/events; sweep at :175 | directly |
| Contractor job lists | `lib/contractor/jobs.ts:181 listContractorJobs`, `lib/contractor/employeeJobs.ts:90` (RPC `employee_jobs`), `app/portal/layout.tsx:53` count | directly |
| Crons/sweeps | `wo-sweep:176,193`, `officeDigests:227`, `customerUpdateDue:45`, `jobReminders:185`, `defectTape:106`, `moneySignoff:320`, `lib/gcal/sync.ts:200,321`, `lib/staff/notify.ts:334,452` | directly |

**Consequence for Step 1:** "one filter in one place" cannot be a TS loader today. The realistic single point is the database: `is_demo` on `work_orders` (+ estimate/invoice children) with (a) RLS/`wo_visible_jobs` carrying it for role reads and (b) a `work_orders_real` view (or a `where is_demo = false` default via a security-barrier view) that the direct readers are repointed to — which is a sweep across those ~58 call sites, not a one-liner. Alternatively the demo job lives on a separate `demo_work_orders`-style shadow, which contradicts I3 "rendered by the same screens". This needs a ruling before Step 1 (see §7).

## 5. i18n / translation

**None.** No i18n library in `package.json`, no `Accept-Language`/`locale` handling (incl. `proxy.ts`), no `t()` helper, no translation files, no language column on `profiles` or `contractors`, no mention of Dari/Farsi/Arabic/Portuguese/Italian/Spanish. `<html lang="en">` hard-coded in `app/layout.tsx:23` and in every generated HTML document (`lib/standards/pdfHtml.ts:27`, invoice/receipt/report HTML). Step 4 starts from zero: `induction_language` on `contractors` (not `profiles` — the painter record), per-language rows in `induction_blocks`, and a `dir="rtl"` path for Dari/Farsi/Arabic that nothing in the portal CSS anticipates.

## 6. Every place this brief's names differ from the code

| Brief | Code |
|---|---|
| "worker login", "role `worker`" | no such role; `profiles.role` is `staff|customer|contractor`; nearest copyable pattern is `account_users` |
| "the old view-only work order link" | `work_orders.crew_token` → `/crew/[token]`, `lib/workorder/crew.ts` whitelist; keep it or retire it is a ruling |
| "Ask a question" | the **Messages** thread (`wo_message_threads/wo_messages`, `MessageThread mode="painter"`) |
| "Change finish date → reason → PC confirms" | `wo_contractor_set_finish_date` applies **immediately**, no reason, no confirm; hidden when no walk-through |
| "Request more" on Materials | nothing; materials are read-only in the portal |
| "Rained off / no work today" from the job | staff-only RPCs |
| "I will add this later" | no step; join collects no certificate |
| "induction_language on the painter's profile" | painter record is `contractors` (there is no `painters` table) |
| "Google Calendar link… block out next Friday" | both exist (`GoogleSyncCard`, `contractor_unavailability`); employees see neither |
| "accept or decline within 24 hours" (Module 10) | `booking_offers` expiry exists (`respond_to_offer` → `error:expired`); the SLA value lives in scheduling settings, not checked here |
| "Create invoice… already filled in" | `contractor_invoice_draft` is **service_role only** and runs from sign-off tails; submit needs **bank details on file** — the demo contractor will fail `contractor_invoice_submit` without them |
| "the demo customer flags one area, Fixed, walk again" | `wo_complete_after_rectification` goes straight to `closed`; there is no "walk again" state |
| "$100 pre-approval rule" | `cost_intake.expenseThresholdCents` 10000 ✔ |
| "MYOB export" (exclusion list) | does not exist; payroll CSV and metrics CSV do |
| "reminder-moment scoring" exclusion | evaluator input is `loadPainterFacts` (`run.ts:48`) |
| "the existing cron or job infrastructure" for 5-second robots | nothing under 5 min; `after()` in the triggering action is the only sub-minute path |
| `lib/painter-status/` | `lib/painterStatus/` |
| Red painter-facing wording (R12 / I16) | **see §8** |
| "the Standards tab in the app" (site card footer) | Standards is under **Help**, not a tab |

## 7. Decisions the build order needs before the step that touches them (⚑ for Tom)

1. **Where the demo scope lives** (§4): DB-level `is_demo` + repoint the ~58 direct readers, or a view with a default filter. Recommendation: `is_demo` on `work_orders`, `estimates`, `invoices`, `contractor_invoices`, `contractor_expenses`, `wo_variations`, `wo_callbacks`, `wo_reminder_moments`, `painter_job_results`; RLS unchanged for the contractor (they must see it); every staff/report reader goes through one `woScope(db)` helper that adds `.eq("is_demo", false)`, enforced by a boundary test that greps for `from("work_orders")` outside the helper — the same pattern as `lib/painterStatus/boundary.test.ts`.
2. **The robot's identity**: a dedicated staff profile ("Paint Group robot", `staff_roles = {pc}`) whose session the server mints, vs. new `…_as_robot` RPC variants that accept `auth.role()='service_role'`. Recommendation: the robot profile — it reuses every gate and every event's `actor` as-is.
3. **Worker login model**: `account_users`-style `contractor_users(contractor_id, profile_id, role worker|owner)` with `profiles.role` staying `contractor`, vs. a new enum value `worker`. Every RLS helper (`current_contractor_id()`, `wo_painter_on_job`) keys on `contractors.profile_id`; a membership table means they gain one join, a new role means every policy is touched. Recommendation: membership table.
4. **Finish-date change**: keep the current immediate apply (and add the reason + customer notice for no-walk-through jobs), or insert the PC-confirm step ⚑12 asks for — the latter changes a shipped feature.
5. **Demo invoice without bank details**: waive `contractor_invoice_submit`'s bank check on `is_demo`, or seed masked demo bank details. Recommendation: waive on `is_demo` inside the RPC.
6. **"Walk again" in the demo**: Module 9 expects flag → Fixed → walk again → sign. The shipped flow closes on Fixed. Either the demo uses `wo_walkthrough_area(approve=true)` (withdraw the flag, back to `walkthrough`, then sign) or the module wording changes. Recommendation: the withdraw path — no new state.
7. **Crew link**: retire `/crew/[token]` once worker logins exist, or keep both. Brief says "no longer how workers are onboarded"; it does not say delete.

## 8. The painter-facing Red status text, as it reads today

Source `lib/painterStatus/copy.ts`; every Red string on the Home card, My status and "How the colours work":

| Where | Current text (contractor) | Lead painter variant |
|---|---|---|
| Home card subline (`homeSubline`, L36) | "No new job offers until you talk with us" | "Talk with us before you lead another job" |
| My status "What you get" (`perksFor`, L68) | "No new job offers until you have talked with us" | same as above |
| My status tips (`tipsFor`, L101–105) | "New job offers are on hold until you have talked with us." / "Jobs you have already started continue as normal." / "We will agree a plan with you to get back to Yellow, then Green." | first line as lead variant |
| How the colours work (`colourKey`, L116) | gets: "No new job offers until you have talked with us." | "Talk with us before you lead another job." |

**None of them is the approved wording.** R12 / I16 require: **"No more job offers. We meet with you to go through the level of finish expected on your current job."** The 8 Oct brief did not carry this line (it was added to the brief on 13 Oct), so the build used its own words. The fix is four strings in one file plus `docs/help/painter-status/{contractor,employee}.md`; the lead-painter variant needs a ruling (the approved line says "job offers", which a lead painter does not get). Colour-change SMS (message 6, `lib/messaging/config.ts`) says "Your status is now Red. Open the app…" and does not carry the line — unchanged by R12.

## 9. The induction PDF (13 Oct, 28 pages) read against the committed export and the code

Tom supplied `Paint Group Contractor Induction.pdf` (export of the Claude Doc, 13 Oct 2026) as the guide. It is a **later, fuller revision** than `docs/induction/induction-v1.md`: every module now carries *What to say* (facilitator lines), a *Check* question, a **Read and confirm** block (first-person statements — "the only part that is translated"), and a *Worker version*. The committed `.md` has none of these. Per the brief §1, the `.md` is what the loader reads and must be re-exported from the doc; **the committed export is stale and should be replaced before Step 4** (the loader needs the Read-and-confirm blocks, which are the translation units).

**What the PDF settles that the brief left loose**

| Topic | PDF says | Effect on the build |
|---|---|---|
| What is translated (§5) | Exactly the Read-and-confirm statements per module, the six standards sections, and the tick line. Slides, app, demo, step names stay English | `induction_blocks` = one row per statement per language; the 13 tick lines are rows too. Worker versions list which statement lines apply (e.g. M7 "lines 1, 2, 5 and 6") — store statements with stable line keys |
| Module 1 set-up | "Open the link in your invite text. Choose your language" → name, mobile, **ABN, GST yes/no, bank details**, painters count → insurance upload or **"I will add this later" → shows as Missing on the home screen** | `/join/[token]` collects name/mobile/password only today; ABN/GST/bank live on the profile. Module 1 needs a join flow that chains language → details → certificates. "Missing" already exists as the Home action list; the button and the flag do not |
| Red wording (M6 slide 4, Check, Read-and-confirm) | "Red: no more job offers. We meet to go through the level of finish expected on my current job." | Confirms §8: `lib/painterStatus/copy.ts` must change |
| DEMO text (⚑4) | "DEMO: Please update your job in the app today." | = "DEMO: " + `contractorJobUpdateSms2` wording, not the first text |
| Materials reply (§4.1 M4) | "Ordered. At the paint shop tomorrow from 7 am." · list shows "Delivered to site, Thursday" · Request more takes a **quantity** | Robot copy; needs a per-item quantity on the (new) Request more |
| Ask a question reply | "attached to the job", "in a few seconds" | = the Messages thread; robot posts via `wo_message_post_from` as the robot staff profile |
| Finish date (M7) | Pick a day, **give a reason**, Save → "shows as logged. On a real job the customer is told and the walk-through is moved" | **No PC-confirm step in the doc** — matches the shipped immediate-apply RPC and contradicts ⚑12's default. Only the reason field is new. ⚑12 should be re-defaulted to "no confirm" |
| Variation (M8) | Category **"Extra item"** · photo · **1.5 hours + note** · "Watch it come back priced and approved… Tap Accept. **Open the invoice preview** and see the line" | No "Extra item" chip: `VARIATION_CATEGORIES` has `extra_scope` labelled "Extra scope" (`lib/workorder/variations.ts:25`) — rename the label or add a chip. "Invoice preview" before sign-off does not exist: `contractor_invoice_draft` runs at sign-off. The demo either shows `contractor_invoice_amounts(wo)` as a preview (read-only) or Module 8 step 3 moves after Module 9's sign-off |
| Walk-through (M9) | "complete the **finish checklist (eight ticks)** and add a final photo" · customer flags "Mark on the hallway wall" · "Tap Fixed, **add a photo, then walk again**. The second walk comes back clean" · "The job moves to **Sign-off, then to Invoice**" | The completion-prep checklist is **five** items (`wo_qa_and_prep.sql:123–128`); the **eight** is the standards' `final_checklist` (shown inside the sixth sign-off section). Decide which the demo shows. "Walk again" confirms §7 item 6 (shipped `wo_complete_after_rectification` closes on Fixed). Stage names in the doc (Sign-off → Invoice) are the nine-step picture, not `wo_stage` values (`walkthrough → closed`) — display labels, not a state change |
| App day to day (M10) | Accept → "moves to **Accepted** and the dates appear in your calendar" · add a worker → share ("in the demo it goes through") · before photo on Ceilings, Walls To do → Prepped → Painted, "each step shows a tick and a time" · **"Tap No work today and pick a reason"** · Ask a question | Stage after accept is `pre_start` (label it Accepted/Booked on the nine-step strip). **Contractor-raised No work today is in the doc as a phone step** → §2 gap confirmed as must-build (RPC is staff-only today). "Tick and a time" = `wo_events` already |
| Money (M11) | Create invoice → "Submitted. On a real job the office approves it and the due date appears" · Expenses: photo, **$20, Parking, 12 Demo Street** → "Pending approval" | `contractor_invoice_submit` needs bank details (§7 item 5); expense flow exists as described |
| Calendar (M12) | Block next Friday → "Unavailable" · Link Google → "**12 Demo Street appears in your Google Calendar within a minute**" | The GCal push is real (`lib/gcal/sync.ts`), cron every 5 min, `syncGoogleCalendarNow` exists — so "within a minute" needs the sync-now call after connect. **This is the one place the demo job leaves the app**: a demo event in the contractor's own Google Calendar. I3 says walled-off; §4.1 says calendar is real. Needs a ruling: push the demo job (as the doc says) or exclude `is_demo` from `lib/gcal/sync.ts` |
| Home screen (M2 slide 4) / site-card footer | "the **Standards tab**" | Standards lives under **Help** (`app/portal/help/standards/`), by the 8 Oct Step 0 ruling. Either the doc says "Help → Standards" or a tab is added — wording change recommended |
| Worker induction (⚑17) | Per-module worker versions: M2 (+ "My contractor accepts… I paint, take photos and tick my surfaces"), M3 all ten lines, M4 first two + "tell my contractor", M5 six ticks, M6 slides 1–2 only + "My work counts toward my contractor's status light", M7 lines 1,2,5,6 (no phone), M8 slides 1,2,5 (no phone), M9 first three lines + tape exercise (no phone), M10 slides 3–5 + "I tick my own work under my own name", M13 lines 1,2,3,5 + "I have a white card". M11, M12 not in | Exact content for `version_kind = worker`; the worker's three-task check as the brief |
| Practical check | Facilitator records five tasks "on your screen"; a **progress screen** "nobody moves on until every phone has ticked" | = `induction_checks` + the staff live grid (§4.2) |
| Refresher | Modules 3, 7, 8, 9, 6 + "What is changing" + the six standards ticks; materials/money/calendar as a one-page handout | As the brief; "What is changing" is a 14th block for the refresher only |
| Day-one visit, after-day checklist | PC visits morning of job one; chase certificates; book the visit | Not app features; a PC queue card for "book day-one visit" would fit `work-queue.ts` |

**Still-open points the PDF itself lists** (unchanged from the brief): Dari vs Pashto; translation method (settled); materials waste; practical-check fail; day-one visit capacity.

**Recommendation for the kickoff of Step 1:** re-export the doc to `docs/induction/induction-v1.md` (or commit the PDF beside it as `docs/induction/induction-v1.pdf` and note the `.md` is behind), and add the rulings above — ⚑12 default, "Extra item" label, which checklist is "eight ticks", the invoice-preview timing, and the GCal push of the demo job — to §7.

---

Step 0 complete. No application code written. Step 1 does not start until Tom has read this and ruled on §7 items 1–3 at least.
