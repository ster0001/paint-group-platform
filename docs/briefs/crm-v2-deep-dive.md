# CRM deep dive and v2 proposal

**Date:** 7 September 2026
**Status:** assessment only. Nothing has been built from this document.
**Asked for by:** Tom, seven points: customer area, messaging as source of truth, rule-based campaigns, dashboard readability, more buckets than temperature, a split diary with Google Calendar, and the whole thing running at 50 to 100 jobs a week for all staff.

This document was produced by reading every file under `app/crm`, `lib/crm`, `lib/campaigns`, `lib/messaging`, `lib/gcal`, the 164 migrations, the four CRM briefs in this folder, and by walking the live screens on the dev server signed in as staff. Every claim below has a file reference in the appendix.

---

## 1. The short version

The CRM is well-designed on paper and thin in practice. The architecture rules are good (one event log, stage derived not stored, one work queue, four tabs) and the code follows them. But the rules were built ahead of the data that feeds them, so most of the system runs on empty:

| What the design promises | What actually happens |
|---|---|
| One event log every screen reads | 42 event kinds are defined. **13 are ever written.** Estimate sent, opened, accepted, declined, job started, job completed and invoice paid never reach the log. |
| Customer record is the source of truth | The record page **does not show the phone number or email**. Nothing in the CRM can edit them. A phone enquiry with no email address **cannot become a customer at all**. |
| Messaging is stored | 19 outbound email paths, 11 SMS paths. **Nine store nothing.** None stores the subject, body or provider message id. **No customer reply by email is captured anywhere.** |
| Campaigns run on customer status | Rules are a flat AND list of 15 fields. **No field for estimate opened, stage, bucket, lead source or consent.** Waits count from the previous message, never from a customer event. |
| Diary shows visits and jobs | **There is no visit or appointment table.** A customer "booking a visit" in the wizard writes a text string on their wizard session. Google Calendar is wired for contractors only. |
| Scales to the business | Customers list loads **500 accounts max** with no search and no paging. Events are capped at 2,000 rows total. Today's loader caps at 200. Every count on screen is the length of a truncated array. |

The good news is that the foundations to fix this are already there: the event-log table, the append-only trigger, the work-queue registry, the segment evaluator, the guard chain, the Resend marketing domain, the Twilio inbound webhook, the Google OAuth flow. The work is to **feed** those systems and **widen** them, not to replace them.

**Recommendation:** six build phases over roughly five weeks of sessions, in the order given in section 5, with eleven decisions from Tom listed in section 6. The first two phases (identity and messaging) unlock everything else and should not be reordered.

---

## 2. What exists today, honestly

### 2.1 Customer area

**Screens:** `/crm/customers` (list or board), `/crm/customers/[id]` (record).

- The list shows initials, name, suburb, a "quoted" pill, value, and days quiet. Six filter chips (All, Leads, Quote sent, Live work, Past customers, Trade). Five sorts. **No search box. No paging.** Loads the first 500 accounts in whatever order Postgres returns them.
- The record shows four stat tiles, a "Log something" panel, and a timeline. **Phone and email are fetched and never rendered.** No list of estimates, one property only, no `tel:` or `mailto:` links.
- The only things staff can write: three call chips (no answer / left message / spoke), a one-line note, Hot/Warm/Cold, "follow up in N days", "snooze N days". The note box is shared by all of them, so a note typed before pressing Snooze becomes the snooze reason and is not saved as a note.
- **Logged calls do not count as activity.** The list's "quiet" counter and "going cold" flag read a fixed set of event kinds that excludes calls. Ring someone five times and the board still says untouched.
- **Nothing in the CRM edits name, phone, email or address.** The estimate builder edits a legacy `contacts` table with no link to `accounts`. `ensureAccount` only writes phone on insert, so a corrected phone never reaches the account.
- No quick-add. Accounts are created only by the estimate builder, the wizard, the AI assistant, magic-link login, or Settings → Trade accounts. `accounts.email` is NOT NULL and the sole identity key.
- Lost customers (all estimates declined) have no lane and no chip. They appear only under "All".
- No owner or assignee anywhere. Every staff member sees the same list, the same queue. Dismissals are global.

### 2.2 Messaging

There are **seven places** a customer's phone or email is stored (`accounts`, legacy `contacts`, `estimates.builder_state.contact`, `estimates.sent_snapshot`, `wizard_drafts`, `external_approvals`, `auth.users`). Different messages read different copies. An invoice email reads the sent snapshot; the invoice SMS reads builder state. An SMS reply is matched only against `accounts.phone`, so a reply to an estimate sent to a builder-state number may match nobody, and **unmatched replies are dropped**, not stored.

Outbound: every email and SMS goes through two raw REST calls that **return a provider message id, which nobody stores**. Where a send is recorded at all, it is a flag plus recipient (`email_sent`, `appt_confirm_sent`) in one of three different event tables. Seven templates instruct the customer to "just reply to this email"; every such reply lands in a human mailbox the platform cannot see.

Inbound: SMS only. STOP/START/HELP are handled correctly and signed. Ordinary replies become an `sms_reply` event, 500 characters max. **There is no inbound email for customers** (the only inbound route is `bills@` for supplier invoices), no bounce or delivery webhook for either Resend account, no read/unread state, and the one real message store, `estimate_messages`, is not visible anywhere in `/crm`.

Calls: manual, three buttons, capturing only a kind and an optional note. No direction, duration, number, outcome, or who made the call (the actor is captured by the RPC and never displayed). The `voicemail` field exists in the schema and the UI never sets it, so every no-answer call renders "No voicemail left".

Six separate template systems exist (Settings blob with 27 fields, hard-coded HTML builders, inline literals, `campaign_templates`, the automations registry, assistant brain entries) with two different token syntaxes.

### 2.3 Campaigns and audiences

- **Audiences** are a flat list of up to 20 rules, all ANDed. Fifteen fields. Multi-select values give OR within one field only. No groups, no OR across fields, no NOT, no if/then.
- Fields that exist: job type (won work only), has job type, completed months ago, won value band, was quoted, is customer, last contact months, suburb, temperature, status not-in (unsubscribed / open work / snoozed), and five wizard-draft fields.
- Fields that do not exist: **estimate opened / not opened / opened N times / dwell / days since sent / days since opened**, stage or lane, wizard bucket, lead source, consent by channel, declined or lapsed, decline reason, quoted value, last contact channel, any event kind, campaign history, owner.
- The evaluator loads up to 2,000 accounts and related rows into memory and filters in JavaScript. At 5,000 accounts a preview silently evaluates 2,000 of them.
- **Campaigns** are always-on drips: a live campaign re-sweeps its audience daily, enrols new matches, and queues up to ten steps (email or SMS, wait N days). The wait counts from the previous queued message, **never from a customer event**. So "three days after the estimate was sent, if unopened" cannot be expressed.
- Stop conditions are implicit: accepted a quote, open work, no longer matches, unsubscribed. **A customer replying or calling does not stop a sequence** because there is no replied fact to read.
- **A send path exists.** The memory notes and three code comments say "no sending code yet"; that is stale. `approveAndSend` sends real email through the marketing Resend domain and real SMS through Twilio, one message per click. There is no bulk approve and `auto_send` has no UI and is never wired into the policy.
- **Analytics: none.** No open tracking, no click tracking, no reply attribution, no conversion. `cta_clicked`, `campaign_bounced` and six other campaign event kinds are defined and never written.
- The campaign cron fires at 08:30 UTC, which is 18:30 or 19:30 Melbourne, outside the C11 sending window, so everything it queues waits until a human approves it the next day.

### 2.4 Statuses and buckets

A customer today can be in these states, across five stores:

| Dimension | Values | Stored or derived | Shown in CRM? |
|---|---|---|---|
| Temperature | hot / warm / cold / unset | stored, staff-set | yes |
| Stage (lane) | 12 lanes + lost | derived on every read | yes, but `lost` has no lane |
| Wizard bucket | 6 values | stored copy of a rule | chip on card |
| Snooze | one timestamp | stored | one line on the record |
| Follow-up | timestamp + note | stored | one tile |
| Marketing unsubscribed | one timestamp, both channels | stored | **no** |
| Estimate status | draft / sent / accepted / declined / expired | stored enum | via stage |
| Job stage, invoice status | enums | stored | not on the record |

What does not exist: do-not-contact, per-channel consent (SMS vs email vs phone), delayed-until with a reason at customer level (snooze is the nearest thing and is unlabeled), archived or duplicate, lost reason vocabulary (the five reasons Tom ruled on 30 Aug are implemented nowhere), tags, custom fields, owner, repaint-due date, a `job_completed` event, and estimate lapsing. **Nothing ever expires an estimate**: `valid_until` is never enforced, so a quote from March still sits in "Estimate sent", going cold forever.

### 2.5 Diary and Today

- `/crm/diary` is one query over `work_orders`, split into "Jobs running" and "Booked" (booked **work**, not booked visits). Its own footer says estimator visits will land when visit booking ships.
- **No visit, appointment or booking table exists** in any of the 164 migrations. `lib/visits/policy.ts` decides self-serve vs phone-first and is tested, but there is no booking module to enforce it. The wizard's "book a visit" offers six generated weekday strings with no availability check, no estimator, no capacity, and writes only a bucket and a text line. It does not even write the CRM event that would put it on Today.
- The `visit_booked` and `visit_done_no_reply` lanes are permanently empty because nothing writes those events. The `visit_rebook` work item cannot fire.
- Google Calendar sync is contractor-only by construction (OAuth gated on `requireContractor`), pushes 07:30–15:30 blocks for committed work, and has no staff equivalent.
- **Today** works and is the strongest screen. Eight of seventeen registered item kinds fire. Priority is one pure function. Paging at 50. But the loaders cap at 100 to 200 rows per source with no ordering, so at volume the queue silently drops items and the badge count is wrong. No grouping by customer, no "mine". The badge rebuilds the whole queue (about 13 queries) on every tab click.

### 2.6 Scale

At 50 to 100 jobs a week the business will hold roughly 3,000 to 5,000 accepted jobs a year, 8,000 to 15,000 estimates, and 10,000+ accounts within twelve months, generating tens of thousands of CRM events a month. Against that:

- Customers list: `accounts .limit(500)`, `crm_events .limit(2000)` across the whole business. Within weeks the events cap covers only the most recent fortnight, so every older account collapses to "no activity" and the "Longest untouched" sort becomes meaningless. The heading prints the truncated count as the total.
- Segments: 2,000-account cap, in-memory.
- Today: 200-row caps, unordered.
- Inbound SMS: scans up to 10,000 accounts in memory per webhook because there is no normalised phone column.
- The `/pc` console uses the correct `fetchAllRows` convention and paid for it with statement timeouts until the RLS policies were rewritten. The CRM does not use that convention anywhere.
- No volume test covers `/crm/*`.

### 2.7 Governance

Rev 1 of the CRM brief and the three sub-briefs (directory/inbox, campaign studio rev 2, site capture) plus the visit-booking brief's original are **still not in the repo**. Under CLAUDE.md line 48 that is a standing stop-and-report, and it is why the stage list, segment fields and inbox were built as best guesses. This document should either be accepted as the replacement source or the missing briefs found.

---

## 3. The five faults underneath all seven asks

Every one of Tom's seven points traces back to one of these. Fixing symptoms one screen at a time will not hold.

**F1. Identity is an email address.** One account = one email, NOT NULL, unique. No phone-only customers, no second contact on a job, no merge, seven copies of contact details. Until this is fixed, the record page cannot be trusted, inbound matching cannot work, and campaigns address the wrong copy.

**F2. The event log is fed by hand.** Lifecycle events are meant to be written by application code at each step, and most steps forgot. The fix is structural: **database triggers** on `estimates`, `work_orders` and `invoices` that write the lifecycle event on state change, so no route can forget. That single change makes the timeline, the stage rules, the segments and the campaign triggers all see reality.

**F3. Messages are not a thing.** There is no `messages` table. Sends are flags in three event tables; replies go to a mailbox. Nothing can be "source of truth" until every send and every reply is one row in one table with channel, direction, body, provider id and thread.

**F4. Facts are computed in memory from capped reads.** Stage, activity, segment membership and work items are all derived by loading everything and looping. That is correct as a rule (derived, never stored) but it needs a **cached facts layer** refreshed by the same triggers, so lists and rules run as SQL with paging and counts. Derived and cached is not the same as stored and drifting.

**F5. There is no "who".** No owner on accounts, no assignee on items, no per-staff view, global dismissals, and the actor of every logged call is captured and never shown. At two staff this is fine. At five it is chaos.

---

## 4. Proposal, point by point

### 4.1 Customer area (Tom's point 1)

**Goal:** any staff member can find a customer in two seconds, see and fix their details, and log what just happened in one click, from wherever they are.

Build:

1. **Contacts under accounts.** New `account_contacts` table (name, role, email, phone, `phone_e164`, preferred channel, is_primary, notes). `accounts.email` becomes nullable; identity resolves by email **or** normalised phone. One `upsertContact` path replaces the seven copies. The legacy `contacts` table is migrated in and retired. **Merge accounts** RPC (keeps the older id, re-points estimates, invoices, properties, events, contacts, logs a `merged` event) with a duplicate finder on phone and address.
2. **The record page redesign.** Header with name, primary phone and email as `tel:` and `mailto:` links, address, owner, status line (see 4.5), tags. Inline edit on every contact field. Tabs or sections: Timeline · Messages · Estimates (all of them, with status, value, opened count) · Jobs · Invoices · Properties · Notes. Nothing the customer has done should require leaving `/crm`.
3. **Quick add** from the Customers tab: name + phone is enough. Creates the account, offers "start an estimate" and "book a visit".
4. **Global search** (⌘K style) by name, phone, email, address, estimate number. Server-side, indexed, returns in under 200 ms at 10k accounts.
5. **One-click logging everywhere.** A "Log" button on every list row, board card and Today item opens a small sheet: outcome (no answer / voicemail / spoke / emailed / texted), direction, a note, and "next: follow up on [date]". Writes the call as a message row (see 4.2) plus the event. Calls count as activity.
6. **Follow-up gets a real date picker** and presets (tomorrow, 3 days, next week, a date), a visible reminder on the record, and a clear button.

### 4.2 Messaging as the source of truth (Tom's point 2)

**Goal:** every email, SMS, call, chat and portal message with a customer is one row in one table, readable on the customer record, and an unanswered one shows up in Today.

Build:

1. **`messages` table.** Columns: account_id, contact_id, channel (email / sms / call / chat / portal / note), direction (in / out), subject, body, body_html, provider (resend / twilio / manual), provider_message_id, thread_id, estimate_id, work_order_id, invoice_id, campaign_message_id, status (queued / sent / delivered / bounced / failed / received), read_at, actor_profile_id, occurred_at. RLS staff-only. Tenant id per A3.
2. **One `recordMessage()` funnel.** All 19 email and 11 SMS call sites go through it, storing the rendered subject, body and the provider id. Small, mechanical change per site.
3. **Inbound email.** A dedicated reply domain on the transactional Resend account (for example `reply.paintgroup.com.au`). Every outbound email sets `Reply-To: reply+<signed token>@reply.paintgroup.com.au`. Resend's inbound webhook posts the reply; the token routes it to the account and thread with no guessing. Unrouted mail (customer wrote fresh to `info@`) is matched by sender address, and if still unmatched it is **stored** as `message_unmatched` and surfaced in Today for a human to attach, never dropped. The existing `bills@` route is the working precedent.
4. **Delivery webhooks** from both Resend accounts and Twilio status callbacks: delivered, bounced, complained, opened (email), clicked. Writes status on the message row and `marketing_undeliverable_at` on hard bounce, which today is read and never written.
5. **Calls.** Phase A is the manual sheet in 4.1 with direction, outcome, duration and number. Phase B, optional and a decision for Tom: Twilio Voice click-to-call from the record, which gives automatic call logs, duration and optional recording for both directions on the business number. The manual sheet stays as the fallback either way.
6. **Chat and portal.** Assistant transcripts get a summary message row on hand-off, and `estimate_messages` migrates into `messages` (keeping the customer-facing thread working). The record's Messages tab is one conversation view across channels, newest first, with reply-in-place for email and SMS.
7. **Work items.** `message_unanswered` (an inbound message older than the threshold with no outbound after it) and `message_unmatched` are already registered kinds. They get their source functions. This is where "did anyone reply to Mrs Kennedy?" lives, and it is why an inbox is not a fifth tab.

### 4.3 Campaigns with real rules (Tom's point 3)

**Goal:** the office builds "if this, and this or that, then send this, unless that" without a developer, on any fact the system holds, including how the customer engaged with their estimate.

Build:

1. **Rule groups.** Criteria become a tree one level deep: match ALL of these groups, where each group is match ANY or match ALL of its rules, with NOT on any rule. That is the pivot-style if/and/or Tom describes and covers everything a painting business will ask for. Deeper nesting is deliberately not offered; it is how lists quietly double.
2. **A field registry** instead of a hard-coded union. Each field declares its label, type, operators and where it reads from, so adding a field is one entry. First-release fields: stage, relationship state, temperature, tags, consent per channel, owner, lead source, job type (from any estimate), quoted value band, won value band, suburb / zone, days since estimate sent, **estimate opened (yes/no, count, total dwell, days since last open)**, accepted / declined / lapsed, decline reason, wizard bucket, last contact (days and channel), campaign history (received / not received campaign X), invoice state, days since job completed.
3. **Event-anchored triggers.** A campaign gets an entry: either "everyone on this audience" (today's model) or "when this event happens" (estimate sent, estimate opened, job completed, visit done, estimate lapsed). Each step gets a **condition** ("skip if opened since", "only if not replied") and the campaign gets **exit rules** (replied on any channel, called us, accepted, declined, do-not-contact, staff took over). Waits count from the anchor event, not from the previous message. This is what "3 days after sent if unopened, SMS; 7 days if opened but silent, email" needs.
4. **SQL evaluation over the facts layer** (F4). Audiences stop loading everything into memory; previews return counts and a sample in milliseconds at any size.
5. **Sending at volume.** Bulk approve on the queue, a per-campaign auto-send switch wired into the guard's `autoSend` (off by default, C9 permitting), and the sweep moved to a cadence that makes hour-level steps possible (see decision 6.9). Guard chain, C10 monthly frequency and C11 window stay exactly as they are.
6. **Analytics.** Per campaign: enrolled, sent, delivered, opened, clicked, replied, converted (estimate accepted within N days), unsubscribed, revenue. All from the message rows and webhooks in 4.2 plus a tracked-link redirect. `cta_clicked` finally gets a writer.
7. **Personalisation tokens** beyond the current three: first name, suburb, estimate total, last job date, estimator name.

**⚑ One conflict Tom must rule on.** Ruling C9a says marketing goes only to customers who accepted. The sequences Tom is asking for target people who were quoted and have not accepted. The clean resolution is two campaign classes: **quote follow-up** (service messages about a quote the person asked for, allowed to quoted-not-accepted, capped at a few steps, stops the moment they answer) and **marketing** (C9a accepted-only, monthly cap). The follow-up class is defensible as an existing business relationship under Australian spam law, but that is a legal opinion to confirm, not mine to give. See 6.1.

### 4.4 Dashboard readability at volume (Tom's point 4)

**Goal:** Today and the Customers list stay readable at 10,000 customers and 300 open items.

Build:

1. **Counts from SQL**, never from array length. Every chip, badge and heading says "showing 50 of 312".
2. **Group Today by customer.** One card per customer with the highest-priority item on top and "+2 more" folded underneath, so one messy job does not fill the screen.
3. **Mine / everyone** toggle, once owners exist. Default to mine.
4. **Collapse by kind with counts** ("12 invoices overdue · expand") and a per-kind cap with "show all".
5. **Customers list**: server-side paging (50), search, saved views (a named filter set built from the same field registry as 4.3, for example "My hot leads quoted this month"), column picker. The board gets lane counts from SQL and a per-lane cap with "show more".
6. **Badge fast path**: a count query, not a rebuild.
7. **Threshold settings** for the follow-up rules (brief §7.1) live in Settings → CRM, not code, so the office can quieten a noisy rule without a deploy.

### 4.5 The status model (Tom's point 5)

This is the piece that deserves the most thought, because "more buckets" done as one bigger dropdown becomes the thing everyone stops updating. The right shape is **five independent dimensions**, each with one job, composed into one status line on the record and card.

**Dimension 1: Stage (derived, keep).** Where they are in the pipeline. Never set by hand. Fix the gaps: `lost` gets a lane; estimates lapse to `expired` by cron on `valid_until` (with a "lapsed" lane and a work item to decide chase or close); `job_completed` and `invoice_paid` get written by triggers so "past customer" is a fact not a guess.

**Dimension 2: Relationship state (stored, staff-set, one value).**

| State | Meaning | Carries | Effect |
|---|---|---|---|
| `active` | default | — | none |
| `delayed` | customer said not now | `until` date, reason, what to do when it wakes | hidden from Today and chase rules until the date; re-fires as a work item on the date with the note |
| `do_not_contact` | never contact for anything non-essential | reason, set by, date | blocks marketing and follow-up sequences on every channel; transactional (invoice, booking) still allowed; big red chip on the record |
| `lost` | we lost this one | one of the five ruled reasons + free text, date | leaves open lanes; kept for reporting; re-opens automatically if a new estimate is created |
| `archived` | duplicate, test, deceased, wrong business | reason | hidden everywhere except search |

This replaces the unlabeled snooze. "Delayed until March, she's renovating the kitchen first, ring then about the exterior" is the single most common thing a painting office needs to record and there is nowhere to put it today.

**Dimension 3: Contact permissions (stored, per channel, with provenance).** Marketing email, marketing SMS, phone calls, each `allowed` / `declined` / `unknown`, plus who set it, when, and how (customer unsubscribed, STOP reply, staff on the phone, portal profile). This is the C9 consent record legal will ask for, replaces the single unsubscribed timestamp, and separates "don't text me" from "don't email me".

**Dimension 4: Temperature (stored, keep).** Staff gut feel. Add: who set it and when on the record, and an optional expiry so a "hot" from June does not still read hot in September (C3).

**Dimension 5: Tags (stored, free-form, office-defined list).** Everything that is true about a customer but is not a state: `referral`, `strata`, `insurance job`, `heritage`, `VIP`, `repeat`, `difficult access`, `Sydney partner`. Filterable, usable in campaign rules, editable inline. Custom fields are not needed if tags and notes exist.

Plus **owner** (dimension zero): the staff member responsible. Set on creation to whoever created it, changeable, filterable.

**What the office sees:** one status line composed from these, for example
`Estimate sent · opened 3× · Warm · Delayed until 12 Mar (kitchen first) · No SMS · Owner: Sam · strata, referral`.

**What the rules see:** every dimension as a field in the registry, so "past customers, exterior, completed more than 7 years ago, not do-not-contact, SMS allowed, not delayed" is an audience in four clicks.

**Derived lifecycle buckets** the office asked for, all computed and all available as filters and campaign triggers: `job completed < 30 days` (after-care), `job completed 30 days to 12 months` (review and referral window), `repaint due` (C7 interval by job type), `quoted and lapsed`, `quoted, opened, silent`, `quoted, never opened`.

### 4.6 Diary (Tom's point 6)

**Goal:** three clearly separate things on one tab: estimate visits by estimator, jobs running, jobs booked. Visits land in the estimator's Google Calendar.

Build:

1. **`visits` table.** account_id, property_id, estimate_id, staff_id (estimator), starts_at, ends_at, kind (quote / re-measure / colour consult / final walkthrough), status (booked / done / no_show / cancelled / rebook), outcome note, source (wizard / staff / phone), gcal_event_id. Staff-only RLS, tenant id. Writes `visit_booked` / `visit_completed` CRM events atomically, which brings the two empty lanes and the `visit_rebook` item to life.
2. **Staff availability and slots.** Per-estimator working hours and zones in Settings; the wizard's slot list is generated from real availability minus booked visits, and `lib/visits/policy.ts` finally has a booking module to enforce. Double-booking is impossible by constraint.
3. **Diary tab** with three sections and a day / week toggle: **Estimate visits** (per estimator lane, with address, customer, phone, "done / no show / rebook" one-click outcomes), **Jobs running** (from work orders, links to the scheduling board), **Booked jobs** (start dates ahead). The heavy contractor board stays at `/pc/schedule`; the diary is the office's day view, not a second scheduler.
4. **Google Calendar for staff.** Reuse `lib/gcal` (OAuth, reconciler, hash-based updates) with a staff connection table. Each visit pushes to the estimator's own calendar as a real event with the address, customer phone and estimate link; moves and cancellations sync; the customer gets an `.ics` confirmation and a reminder SMS the day before via the existing automations registry. One-way push is enough for phase one.
5. **Booked jobs to Google** for staff who want them, using the same connection (today only contractors get their blocks).

### 4.7 Running at 50 to 100 jobs a week for all staff (Tom's point 7)

Beyond the items above:

1. **Owner and scoping.** `accounts.owner_id`, `visits.staff_id`, per-staff Today, and a decision on whether an estimator sees only their own customers (brief 7.3) which affects RLS.
2. **Facts layer** (F4): a `crm_account_facts` table maintained by the lifecycle triggers, holding stage, last activity, last contact, opened count, quoted value, won value, last job completed, next visit, next follow-up. Everything lists and filters from it in SQL. It is derived and rebuildable from the event log by one script, which keeps faith with the "derived, never stored" rule.
3. **`fetchAllRows` or paging everywhere in `/crm`**; no bare `.limit()` on a table that grows with the business.
4. **`phone_e164` column** and index so inbound matching is a lookup.
5. **A volume gate for `/crm`**: the existing 25,000-account seed, p95 under 500 ms for Today, Customers, a record and a segment preview, run in CI like the portal one.
6. **Staff onboarding**: a "first hour" help page in the help centre and keyboard shortcuts for the three things everyone does (search, log, next item).
7. **Cron cadence.** Sequences with day-level steps work on a daily cron; anything hour-level, and the escalation SMS for chat hand-offs that is currently unscheduled, needs the 30-minute schedule, which the Vercel Hobby plan forbids.

---

## 5. Build order

Each phase is one PR with its migrations, tests and a manual-test note, verified by driving the real screens. Sizes are rough session-days based on how past batches went.

| Phase | What ships | Depends on | Size |
|---|---|---|---|
| **P1 Identity and facts** | `account_contacts`, nullable email, `phone_e164`, merge RPC and duplicate finder, lifecycle triggers writing `crm_events`, `crm_account_facts`, estimate lapsing cron, `lost` lane | — | 4 |
| **P2 Customer area** | Record redesign with contact edit, quick add, global search, paging and counts, one-click log sheet, date-picker follow-up, owner field | P1 | 3 |
| **P3 Messaging spine** | `messages` table, `recordMessage` funnel across all 30 call sites, reply-routing domain and inbound webhook, delivery webhooks, unmatched handling, Messages tab on the record, `message_unanswered` / `message_unmatched` items, `estimate_messages` migrated | P1 | 5 |
| **P4 Status model** | Relationship state, per-channel permissions, tags, lost reasons, composed status line, saved views, thresholds in Settings | P1, P2 | 3 |
| **P5 Campaigns v2** | Rule groups, field registry, event-anchored triggers with step conditions and exits, SQL evaluation, bulk approve, analytics, tokens, follow-up vs marketing classes | P1, P3, P4 | 5 |
| **P6 Diary and visits** | `visits` table, availability and slots, three-part Diary, staff Google Calendar, customer `.ics` and reminder | P1, P2 | 4 |
| **P7 Scale gate** | Today grouping and mine/everyone, badge fast path, volume e2e for `/crm`, per-staff scoping if ruled | P2, P4 | 2 |

Twenty-six session-days, roughly five to six working weeks if run in sequence, less if P3 and P4 run in parallel branches (they touch different tables). **P1 is not optional and not reorderable**; everything else reads what it writes.

What this deliberately does not do: no new top-level tab (the inbox lives on the record and in Today), no stored `work_items` table, no second customer table, no drag-to-stage, no send-to-a-friend. The existing rulings hold.

---

## 6. Decisions needed from Tom

| # | Decision | Why it blocks | Recommendation |
|---|---|---|---|
| 6.1 | **Quote follow-up sequences to quoted-not-accepted customers** vs ruling C9a (accepted-only marketing) | P5 cannot build the estimate-view campaigns Tom asked for without it | Two classes: follow-up (service, short, stops on reply) and marketing (C9a). Confirm with the lawyer handling C9. |
| 6.2 | **Phone-only customers**: is it acceptable that a customer record can exist with a phone and no email? | P1 changes the identity key | Yes. Half of first calls have no email. |
| 6.3 | **Relationship states**: the five in 4.5, their names, and whether `delayed` requires a date | P4 | As listed. `delayed` always requires a date. |
| 6.4 | **Per-channel permissions**: email, SMS and phone as three switches, and whether "phone: declined" should also block staff call prompts in Today | P4, legal C9 | Three switches; a declined phone hides call prompts but not the number. |
| 6.5 | **Owner model**: does an estimator see only their own customers, or everyone with a "mine" filter? (brief 7.3 and 7.9) | P2 field, P7 RLS | Everyone, "mine" default, owner filter. Revisit when there are more than five staff. |
| 6.6 | **Inbound email domain**: a reply subdomain on the transactional Resend account (needs one DNS record) | P3 | Yes, `reply.paintgroup.com.au`. |
| 6.7 | **Telephony**: manual call logging only, or Twilio Voice click-to-call with recording | P3 scope | Manual first; decide on Voice after a month of real logs. |
| 6.8 | **Repaint intervals by job type** (ruling C7, still open) | the "repaint due" bucket and campaign | Exterior 7 years, interior 10, as a Settings default the office can change. |
| 6.9 | **Vercel Pro plan** so crons can run every 30 minutes | hour-level campaign steps, chat escalation SMS, visit reminders | Yes. It is the cheapest fix in this document. |
| 6.10 | **Accept this document as the source** in place of the missing rev-1 brief and sub-briefs, or supply them | CLAUDE.md line 48 stop-and-report | Accept this, and amend the retargeting brief to point here. |
| 6.11 | **Lost reasons on lapse**: when an estimate expires with no answer, is the customer `lost` automatically, or does a work item ask a human first? | P1 lapsing cron | A work item asks; lapse is not the same as lost. |

---

## Appendix A. Evidence

Customer area: `app/crm/customers/page.tsx:31-65` (sorts, groups), `app/crm/customers/data.ts:15-45` (caps), `app/crm/customers/[id]/page.tsx:35` (phone fetched, never rendered), `app/crm/CustomerPanel.tsx:58-109` (the whole edit surface, `dayCount` returns 3 for 0), `app/crm/actions.ts:20` (`LOGGABLE`), `lib/accounts/link.ts:48-58` (phone only on insert), `supabase/migrations/20261128000000_customer_accounts.sql:36-53` (email NOT NULL unique), `supabase/migrations/20260814010000_contacts.sql` (legacy table, no FK).

Events: `lib/crm/events.ts:34-105` (42 kinds), writers at `app/crm/actions.ts:40`, `app/api/sms/inbound/route.ts:66-100`, `app/api/estimates/[id]/wizard-edit/route.ts:508`, `app/api/wizard/submit/route.ts:560-581`, `app/api/wizard/outcome/route.ts:62`, `app/api/agent/start/route.ts:86`, `app/api/events/route.ts:40`, `app/api/cron/agent-sweep/route.ts:64`, `lib/wizard/sweep.ts:38`, `app/crm/campaigns/campaignActions.ts:377`, `lib/agent/scope-tools.ts:66-221`. `supabase/migrations/20261205000000_crm_spine.sql:11-14` (the "one log" claim).

Messaging: `lib/messaging/send.ts:44-96` (Resend and Twilio, ids returned), `lib/campaigns/send.ts:105-126`, `app/quote/actions.ts:144-193`, `lib/invoicing/sendInvoice.ts:158-315`, `lib/workorder/sendUpdate.ts:99-138`, `lib/workorder/signEmail.ts:131-148` (no record), `app/api/inbound/bills/route.ts` (only inbound email), `lib/campaigns/inboundSms.ts:62-71` (in-memory phone scan), `app/api/sms/inbound/route.ts:57-106` (unmatched dropped), `supabase/migrations/20260918000000_estimate_chat.sql:11-18`, `lib/messaging/config.ts:14-79` (27 template fields), `lib/automations/registry.ts:76`.

Campaigns: `lib/crm/segments.ts:25-73` (15 fields, flat AND), `:167-169` (evaluator), `lib/crm/loadSubjects.ts:38-140` (caps), `supabase/migrations/20261209000000_campaign_engine.sql`, `lib/campaigns/guard.ts:41-147` (policy and chain), `lib/campaigns/sweep.ts:117-120` (wait from previous message), `app/crm/campaigns/campaignActions.ts:237-383` (`approveAndSend`), `app/crm/campaigns/queue/Queue.tsx:56`, `app/crm/campaigns/c/[id]/CampaignBuilder.tsx:161` (stale "no sending code"), `vercel.json` (cron at 08:30 UTC), `supabase/migrations/20260815000000_customer_view.sql:39-101` (`estimate_views`, `record_estimate_view`), `app/quote/QuoteBuilder.tsx:899` (the only reader).

Statuses: `lib/crm/stage.ts:17-57,121-247`, `lib/wizard/journey.ts:11-46`, `supabase/migrations/20261207000000_crm_judgement.sql:22-27,86-88`, `supabase/migrations/20270107000000_wizard_sessions.sql:35-50`, `supabase/migrations/20260815000000_customer_view.sql:23` (`declined_reason` free text), `docs/briefs/crm-decisions.md:87-90` (the five reasons, unimplemented), `supabase/migrations/20260813000000_initial_schema.sql:234` (`valid_until`, unenforced).

Diary and scale: `app/crm/diary/page.tsx:8-16,29-49,88-92`, `lib/visits/policy.ts:52`, `lib/wizard/scope-editor.ts:634-645` (generated slots), `app/api/estimates/[id]/wizard-edit/route.ts:522-559` (`book_visit`), `lib/gcal/sync.ts:16-66,189-213,436-446`, `app/api/gcal/connect/route.ts:14` (`requireContractor`), `lib/crm/work-queue.ts:27-51,118-136,155-163,606-663` (kinds, weights, priority, caps), `app/crm/today/page.tsx:19,64-67`, `app/crm/api/badge/route.ts:22`, `app/crm/CrmTabs.tsx:41-49`, `lib/supabase/fetchAllRows.ts`, `supabase/migrations/20261213000000_wo_policies_indexed.sql` (the RLS lesson), `lib/staff/access.ts:13-28`, `e2e/portal-volume.spec.ts`.

Governance: `CLAUDE.md:9-10,48,50`, `docs/briefs/crm-decisions.md:166-183`, `docs/briefs/claude-code-brief-crm-retargeting.md:48-54,83-87,235-247`, `docs/briefs/claude-code-brief-crm-shell-work-queue.md:39-54,283-295`, `docs/briefs/wizard-progress-crm-buckets.md:30-54,99,152-158`.
