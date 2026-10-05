# Visit booking, addendum A — S0 report (read and report, no code)

**Date:** 5 October 2026 · **Branch:** `feat/visit-booking-s0` · **Brief:** `docs/briefs/claude-code-brief-visit-booking-addendum-a.md`

No code was written. This report answers section 7 / S0 of the addendum. Every path is relative to the repo root and was read in this session.

---

## 1. Reference files

Committed in `8adf710`:

| File | Path | Note |
|---|---|---|
| Addendum A | `docs/briefs/claude-code-brief-visit-booking-addendum-a.md` | identical to the copy in Downloads |
| Mockup 4 | `design/reference/paint-group-visit-booking-mockup.html` | |
| Zone map, draft 2 | `design/reference/paint-group-visit-zones-map.html` | |
| Zone outlines | `docs/briefs/data/visit-zones-draft2.geojson` | 10 features: zones 1–5 (priority 1–5) and 5 pre-arranged parts (priority 6) |
| Suburb rulings | `docs/briefs/data/visit-zones-suburb-rulings.csv` | 210 rows, force-added past the repo's blanket `*.csv` ignore (same as `design/reference/paint-group-products.csv`). Suburb names and statuses only, no customer data |

Must-exist files, all present:

| Brief says | Found at |
|---|---|
| `CLAUDE.md` | `CLAUDE.md` |
| `docs/briefs/claude-code-brief-visit-booking.md` | same |
| `docs/briefs/wizard-progress-crm-buckets-brief.md` | **`docs/briefs/wizard-progress-crm-buckets.md`** (no `-brief` suffix) — used that |
| `docs/briefs/messaging-automations-inventory.md` | same |
| `docs/briefs/claude-code-brief-home-dashboard-v2.md` | same |
| `docs/briefs/claude-code-brief-crm-retargeting.md` | same |
| `docs/briefs/claude-code-brief-customer-portal.md` | same |

**Two things about the data files worth knowing before S1:**

- The rulings CSV has **no postcode column** (columns: `suburb, expected_status, basis, far_edge`). The brief describes it as suburb + postcode and S1 resolves by suburb + postcode together. S1 will have to join the CSV to the Victorian suburb/postcode list by suburb name. Victoria has repeated suburb names (several Newtowns, Golden Points, etc.); any name in the CSV that matches more than one Victorian locality will be reported, not guessed.
- `far_edge` is the word `proposed` on 24 rows (Lilydale, Mornington, Mount Eliza, Langwarrin, Baxter …), blank on the rest. Those 24 are the R18 far-edge seed.
- `.gitignore` ignores `*.csv`; `visit-zones-review.csv` (S1) will need `git add -f` too.

---

## 2. Answers to the S0 questions

### 2.1 How the wizard stores the address — suburb and postcode ARE separate fields

- Client state: `WizardState.address = {street, suburb, state, postcode, formatted} | null` (`lib/wizard/state.ts:97-107`), set only when a Google Places suggestion is picked (`app/components/useAddressLookup.ts`, `app/api/places/details/route.ts:59-71` keeps `locality` → suburb, `postal_code` → postcode). Typed-not-picked addresses go through `parseAddressText()` (`lib/wizard/addressText.ts:13-52`) or the manual suburb/postcode inputs (`app/wizard/WizardApp.tsx:1858-1890`); the wizard refuses to continue without a picked address or suburb + postcode (`WizardApp.tsx:1469-1474`).
- Server: `wizard_drafts.suburb` / `.postcode` columns (`supabase/migrations/20261210000000_wizard_drafts.sql`) written by autosave (`app/api/wizard/draft/route.ts:162-184`), plus the whole `state` jsonb. On submit, `properties.suburb/postcode/address_norm` via `ensureAccountAndProperty` (`lib/accounts/link.ts:154-181`) and `builder_state.jobAddress` on the estimate (`app/api/wizard/submit/route.ts:652-659`).
- So the 4.1 resolver can read suburb + postcode from the stored draft/property server-side. Nothing new is needed on the capture side.
- Pre-existing bug seen in passing: `app/api/wizard/save-and-book/route.ts` (~L120-128) reads `address.address/city/postal` (the builder's keys) off the wizard state, which uses `street/suburb/postcode`, so Save & book never links a property. Not fixed; noted for the session that touches that route.

### 2.2 How the current gate works — there is no gate

- `lib/wizard/state.ts:571-588` records the ruling "THE EMAIL GATE IS GONE (estimator journey v2 ⚑1, phase 2)". `/api/wizard/submit` creates the estimate and **returns the range in the same response with no contact details** (`submit/route.ts:1016-1033`). The only requirement is an anonymous Supabase session.
- Contact capture today is all after the range: "Keep this estimate" on the reveal (`app/wizard/Reveal.tsx:84-102`, posts to `app/api/wizard/keep/route.ts`, email only, no phone, no lead row), the Save & book sheet (`app/wizard/SaveAndBookSheet.tsx`), the commercial brief path, and a client-only legacy `PageContact` on the old page sets that the server never enforces.
- **Consequence for R5 / S6:** "details first" is new server-side enforcement on `/api/wizard/submit` (the range must not be returned until name + email + mobile are stored on the draft), not a re-enable of something switched off. The code comment above records the opposite ruling and will be updated to cite the addendum when S6 lands.
- **Two-estimates limit** (`submit/route.ts:175-211`): `settings.wizard_limits.maxEstimatesPerVisitor` (default 2) over 24 h, counted on `wizard_leads` by email OR IP hash (`WIZARD_IP_SALT`). But `wizard_leads` is only written when an email is present (`:754`), so a visitor who never gives an email is never counted — today the limit is effectively inert for anonymous runs. The gate restores it (S6 done-when "the two-estimates limit per email and IP still holds").

### 2.3 How `wizard_sessions` records steps — it is `wizard_drafts`

- There is no `wizard_sessions` table. `supabase/migrations/20270107000000_wizard_sessions.sql` says "The brief's `wizard_sessions` IS `wizard_drafts`" and adds `mode, entry_source, address, current_page, furthest_page, pages_total, outcome, outcome_at, active_seconds, step_times, last_heartbeat_at, dropped_at, bucket`. `20270136` adds `version` + `last_screen`; `20270181` makes the bucket forward-only by trigger.
- Heartbeat: `app/api/wizard/heartbeat/route.ts`, 15 s while visible and active (`WizardApp.tsx:1225-1259`). Bucket rule `lib/wizard/journey.ts:40-48`. Sweep `lib/wizard/sweep.ts` + `app/api/cron/wizard-sweep`.
- **Nothing records** gate shown / gate completed / range shown / option chosen on the range screen / which gate version a session saw. "Completed" is `converted_at`. The dashboard funnel (`lib/reporting/metrics/funnel.ts`, `app/(app)/home/FunnelCard.tsx`, the "Where estimates go" card) has steps started → email → saved → sent → viewed → accepted, and the email step has no timestamp. The 4.7 tracking is additive columns on `wizard_drafts` plus new funnel steps; no new table.

### 2.4 How the work queue takes a new item type

- `lib/crm/work-queue.ts`: derived every call, never stored (L19-34). A new kind is added to `WORK_ITEM_KINDS` (L39), `KIND_WEIGHT` (L192), `GROUP_OF_KIND` (L298) and `KIND_TAG` in `app/crm/today/page.tsx:28` (all typed `Record<WorkItemKind, …>`, so the compiler enforces it), optionally `CUSTOMER_VISIBLE` (L170, +40 priority). Then a pure `buildXItems(rows, now)` calling `finish()` (L1085) with a `dueAt`, and one bounded read + spread in `buildWorkQueue` (L1519-1840). `bucketFor()` (L277) turns `dueAt` into overdue / today / waiting by Melbourne calendar day. Keys via `itemKey()` must be stable (dismissals match on them).
- `SubjectRef.type` already includes `"visit"` and `"wizard_session"` (L111-114). `visit_rebook` already exists (L784).
- **Gap for R23/R33:** `lib/time/businessHours.ts` (`isBusinessDay` L40, `addBusinessHours` L56, `nextBusinessMorning` L71) is Monday–Friday only. **No public-holiday list or helper exists anywhere** (the only "holiday" hits are school-holiday wizard copy and commercial segments). S4 adds a `public_holidays` Settings value and a holiday-aware `nextWorkingDayEnd()` beside the existing helpers; the two existing "working day" helpers stay weekday-only unless Tom wants them to honour the list too (see §4, decision c).

### 2.5 How messages are sent and made editable

- One adapter `lib/messaging/send.ts` (Resend email, Twilio SMS), every send recorded in `messages`. Automatic sends go through `sendAutomation()` (`lib/automations/dispatch.ts:118`): on/off switch, channel, sending hours, daily cap, "office approves first".
- Wording is editable because every template is a field on the one `settings` row keyed `messaging` (`MessagingSettings` + `DEFAULT_MESSAGING`, `lib/messaging/config.ts:16,164`), rendered by `renderTemplate` (`:448`), edited at Settings → Communications & automations (`app/(app)/settings/AutomationsSettings.tsx`) from the registry `lib/automations/registry.ts`. A new message = field + default + placeholders in `TemplateVars`/`SAMPLE_VARS` (`lib/automations/controls.ts:196`, `registry.test.ts` enforces samples) + registry entry + a row in the inventory doc (hand-maintained, recipe at `messaging-automations-inventory.md:146`).
- Already in the registry and reusable: `visit_confirmation` (email + .ics, fields `visitConfirmSubject/Body`) and `visit_reminder` (SMS, `visitReminderSms`, rides wo-sweep at 6 pm Melbourne). The section-10 list adds: text code, request received, time offered, visit cancelled, call request received, customer message copy, plus the staff work-queue kinds.
- **No OTP / code-by-text flow exists** anywhere (`lib/visits/policy.ts:9-11` mentions it as planned). Portal login is an email magic link. S3 builds the hashed-code flow from scratch.
- **Rate limiting is in-memory per Vercel instance** (`lib/security/tokenRouteLimit.ts`, `lib/places/publicLimit.ts`, `lib/portal/auth.ts:27-45`). Section 8 tests 10 and 11 (five wrong codes ends the hold; 20 codes to one mobile in a minute is limited) need counters that survive across instances, so the hold row itself will carry `attempts` and `resends`, and the per-mobile / per-IP limit will be a small DB-backed count. Noted so it is not "solved" with another in-memory map.

### 2.6 Where the office phone number is stored

- `settings` key `company_profile`, field `phone` (and `phoneHours`), edited at Settings → Company → Company details (`app/(app)/settings/SettingsForm.tsx:65,68`), read as `company.phone` via `loadMessaging` (used by `lib/visits/notify.ts:108`, `ReachStrip`). **The setting exists, so S4 "Call us" does not STOP.**
- There is also a hard-coded marketing constant `PHONE_DISPLAY = "03 8840 9414"` in `lib/marketing/site.ts:6-7`. The wizard's Call us button will use the Settings value, not that constant.
- Office email for R35: `settings.messaging.officeEmail` (default `info@paintgroup.com.au`, `lib/messaging/config.ts:340`), fallback `company_profile.email` (`lib/estimates/chat.ts:75`). **Exists, so R35 does not STOP.**

### 2.7 Whether the staff scheduling calendar can show a visit

- Two staff calendars exist. The **CRM Diary** (`app/crm/diary/page.tsx`, `DiaryVisits.tsx`) shows estimator `visits` per estimator lane plus the estimator's Google busy times. The **Schedule board** (`/schedule` → `/pc/schedule`, `lib/scheduling/board.ts`) is painters only: work orders, offers, `wo_appointments`, pink `schedule_holds`; its `BlockKind` (`board.ts:51`) has no estimator-visit type.
- So: yes, on the Diary, which is where estimator visits already live. Booked visits from this module will appear there with no new surface. The painter Schedule board is not touched.

### 2.8 Where customer chat lives and how a customer message is posted

Two existing stores, both already merged into the one staff inbox (`app/api/agent/inbox/route.ts:78`). **A conversation store exists, so 4.5 does not STOP.**

- **Estimate chat**: `estimate_messages` (`supabase/migrations/20260918000000_estimate_chat.sql`), keyed by the estimate's `share_token`, no account needed. Customer post = `postCustomerChatMessage(service, {token, body})` (`lib/estimates/chat.ts:29`) → RPC `post_estimate_message_by_token` → `office_estimate_chat` staff alert → office-email fallback. Staff reply from the builder, the staff dock, or by emailing back (`lib/estimates/chatReply.ts`).
- **Website chat**: `agent_conversations` / `agent_messages` / `agent_handoffs` (`20261228000000_agent_schema.sql`), `account_id` and `estimate_id` nullable, anonymous visitors by `anon_token`; staff reply at `app/crm/chat/[conversationId]/`.
- Proposed use (decision b in §4): after the range the customer has an estimate, so Send us a message posts into the **estimate chat** (one place, same as "Chat with us" on the estimate today). Before the range there is no estimate yet, so a pre-range message posts into the **website chat** conversation with the draft's `anon_token`. Both are existing stores; neither is a new inbox. Idempotency for test 17 uses the existing `dedupe_key` pattern on the email send and a client request id on the post.

### 2.9 Where the existing price limits live

- `settings` key `wizard_policy` (`lib/wizard/policy.ts:50-62`): `interiorSelfServeCapCents = 600_000` ($6,000), `exteriorSelfServeCapCents = 1_200_000` ($12,000), plus accuracy bars, `minJobCents`, and `remoteConfirmCapCents` / `remoteConfirmInteriorOnly` (the "fix the price without a visit" cap, no UI editor). Screen: Settings → Estimates → "Accuracy tiers & online cap" (`app/(app)/settings/TiersSettings.tsx:78-90`).
- R34 is satisfied by seeding two new values `speakWithUsInteriorCapCents` / `speakWithUsExteriorCapCents` from those and showing them under Booking rules. The server compares the **top** of the range.

---

## 3. What already exists for visits (not asked, but it shapes every session)

CRM v2 P6 built an estimator-visit module that the addendum extends rather than replaces:

| Piece | Where | Keep / change |
|---|---|---|
| `visits` table: estimator, starts/ends, kind `quote…`, status `booked/done/no_show/cancelled/rebook`, source `wizard/staff/phone/assistant`, exclusion constraint `visits_no_double_booking` per estimator, RPC-only writes (`visit_book`, `visit_move`, `visit_set_status`), triggers that write `crm_events` | `supabase/migrations/20270127000000_crm_visits.sql` | **Keep.** The booking of S3 is a `visits` row with `source = wizard`. Holds and codes are new tables beside it |
| `settings.visits`: `horizonDays 10`, `cutoffHours 24`, AM/PM windows, `reminderHour` | `lib/visits/types.ts:48-59`, Settings → Company → Estimator visits (`VisitsSettings.tsx`) | **Becomes the Booking rules screen.** One settings source: the new rules (2 h notice, 3 weeks, 10-minute hold, 90/60 minutes) replace horizon/cutoff/windows in the same key, so there are never two places that say how far ahead a customer can book |
| Half-day window engine `offeredWindows` / `pickSlot`; wizard booking `wizardVisitSlots` / `bookWizardSlot`; `/estimate/book` with `ReachStrip` | `lib/visits/availability.ts`, `lib/visits/wizard.ts`, `app/estimate/book/Book.tsx`, `app/estimate/scope/ReachStrip.tsx` | **Replaced** by named slots (parent-brief row "zone half-days" in §3). The new availability function lands beside it in S2; the old windows stop being offered to customers in S3 |
| Estimator by postcode `profiles.patch_postcodes`, `staff_availability.zone` | `lib/wizard/estimator.ts`, `20270127` | Superseded by the zone table (R11: a zone belongs to one estimator) |
| `confirmation_requests` (`kind = visit`) and `callback_requested` events | `20270137000000_confirmation_requests.sql`, `app/api/wizard/callback/route.ts` | Reuse for the request kinds in 4.4 where the shape fits; otherwise extend, not duplicate |
| `crm_events` types `visit_booked`, `visit_cancelled`, `visit_booked_from_wizard`, `callback_requested`, `confirmation_requested` | `lib/crm/events.ts:33` | Reuse; add `visit_hold_placed`, `visit_declined_by_customer`, `visit_moved_in_google` etc. as schema lines |
| Google Calendar, staff: scopes `calendar.app.created` + `calendar.readonly` (`lib/gcal/oauth.ts:18-31`); writes to an app-created "Paint Group Visits" calendar (`lib/gcal/staff.ts:27,107`); reads busy from the person's other calendars with a 2-minute cache (`lib/gcal/read.ts:111,155`, folded into `loadBusy()` `lib/visits/book.ts:58`); mapping `staff_gcal_events` (kind `visit|job`); events carry **no attendees**; **no push channels**; re-sync inside wo-sweep (`app/api/cron/wo-sweep/route.ts:214`) | `lib/gcal/*`, `docs/gcal-setup.md` | See §4 decision a. The read side is reusable as is (it already treats all-day events as busy and skips our own calendars). The write side must change scope to put a visit **in the main calendar with the customer as guest** (R21, decision 2) |
| Customer invite today = `.ics` attached to the `visit_confirmation` email | `lib/visits/notify.ts` | Replaced by Google's own guest invitation once the event carries the customer (R22 depends on the decline reaching Google) |

Pre-existing bug, not fixed: every "Book your estimator" / "Book a time" link off the range screen goes to `/estimate/scope?id=…#reach`, but `id="reach"` only renders on `/estimate/book` (`ReachStrip.tsx:70`, rendered from `Book.tsx` only since `3d3ad8c`), so those links land on the scope editor with nothing to scroll to (`Reveal.tsx:232,256`, `WizardApp.tsx:1680`, `Finish.tsx:274-285`). The S6 range screen replaces those buttons, which closes it.

---

## 4. Things that need Tom before the session that touches them

None of these stops S1 or S2. Each has a recommended answer.

| | Question | Recommended |
|---|---|---|
| **a** | **Google scope.** Today the app can only write to calendars it created (`calendar.app.created`) and read others. R21 + decision 2 want the visit in info@'s **main** calendar with the customer as a guest, and R22 needs the guest's decline. That needs the `calendar.events` scope (sensitive). With a Google Workspace account the OAuth app can be set **Internal** and no verification is needed; with a standard Gmail account the consent screen shows "unverified app" until Google verifies it (weeks). Section 11 already asks which kind of account info@ is. | Tell me which. If Workspace: Internal + `calendar.events`, S5 proceeds. If standard Gmail: fall back to writing into the app-created "Paint Group Visits" calendar (which already exists, no new scope) and reading the main one for busy times; the customer invite still arrives from Google because the guest is on the event. The only visible difference is which calendar inside the account holds the visit |
| **b** | **Which chat store for a message sent before the range** (2.8). | Estimate chat after the range, website chat before it. Both already in the one staff inbox |
| **c** | **Should the existing weekday-only helpers** (`addBusinessHours`, `nextBusinessMorning`, used by desk-check and photo-review due times) **also honour the new public-holiday list?** | Yes, once the list exists; a one-line change in `lib/time/businessHours.ts`. Otherwise two definitions of "working day" would exist |
| **d** | **Parent-brief conflict not covered by section 3** (see §5). Does a lead-paint flag, "damage beyond minor", or a tenanted / not-authorised property still bar a customer from self-serve booking? | No bar; R2 says everyone who has seen their range can book, and R30 drops the authorised tick. The flags still show on the staff side of the visit so the estimator knows before they go |

---

## 5. Parent brief vs addendum — conflicts section 3 does not list

- **Parent §2.4 / acceptance 4:** routing to `phone_first` for lead paint, damage beyond minor, tenanted / not authorised, commercial / multi-property, amber custom lines; "lead-paint-flagged jobs can never reach `self_serve`". Section 3 removes `phone_first` as an outcome and removes the authorised gate, but says nothing about lead paint or damage. Read with R2 these flags no longer block booking. Flagged as decision d above; building to R2 unless told otherwise.
- **Parent §2.1 / acceptance 2:** every surface (wizard, portal, assistant tool, PC console) calls one policy function with parity. Addendum §12 puts the assistant and trade/commercial accounts out of scope and does not mention the portal. The address → outcome resolver (4.1) will still be one server function that any surface can call, so parity is preserved by construction; only the wizard surfaces are built in these sessions.
- Everything else in the parent brief is either covered by section 3 (half-days, arrival windows, open calendar, the four gates) or by §12 (reschedule V3, who attends V5).

---

## 6. Rulings reversed by the addendum that the code currently records the other way

- `lib/wizard/state.ts:571-588` records "the email gate is gone" (estimator journey v2 ⚑1). R5 (details first, by default) reverses that for the "details first" version; R6's switch keeps the old behaviour available as "range first". S6 updates the comment to cite the addendum.
- `settings.visits` records horizon 10 days and 24-hour cutoff; R15/R16 make it 2 hours and 3 weeks. S2 replaces those values in the same settings key.

---

## 7. Session plan check (unchanged from the brief)

S1 zones → S2 schedule + pure availability function → S3 walking skeleton (book from the range screen with the code) → S4 requests, pre-arranged, out of area, Speak with us, messages → S5 Google Calendar → S6 the gate and the range screen → S7 full loop, help pages, inventory. Migrations one per session, pasted by Tom between gate runs, each ending with its `_prod_migrations` row.

S1 needs: a Victorian suburb + postcode + centre-point list with a licence that allows committing it (source and licence will be in the S1 report), and `git add -f` for the review CSV.
