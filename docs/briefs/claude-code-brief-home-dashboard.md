> **SUPERSEDED 19 Sep 2026 by claude-code-brief-home-dashboard-v2.md — kept for design history. Do not build from this file.**

# Claude Code brief — Home dashboard (role views, long-term source of truth)

**Status:** v1 for Tom's review · 19 Sep 2026
**Supersedes:** the 2 Sep "business dashboard" discussion and the owner-dashboard mockup (owner-dashboard-mockup.html stays as the visual reference for tiles, charts and the "Where estimates go" funnel).
**Route:** `/home` — the landing page for every staff login. Contractors and customers keep their portal homes.

---

## 0. How this fits the platform

The dashboard is the one place staff look to know what is true. It writes nothing. It reads the logs the other modules already keep and turns them into numbers, lists and a timeline:

| Source (already built or briefed) | What the dashboard reads from it |
|---|---|
| `estimate_events` (draft/sent/viewed/downloaded/accepted/declined/lapsed) + `estimates` | Sales, Where estimates go, Sales activity |
| `crm_events` + `wizard_sessions` | Lead source, funnel drop-offs, warm leads |
| `wo_events`, `wo_surfaces`, `wo_variations`, `wo_qa_checks`, `wo_walkthroughs`, `wo_signoff`, `wo_updates` | PC Command, Contractor |
| `invoices`, `invoice_events`, `payments`, `contractor_invoices`, `contractor_expenses` (via `lib/invoicing/ledger.ts`) | Invoicing, P&L revenue received |
| `cost_intake` (matched materials and job costs) | Materials est vs actual, P&L |
| messages / threads (messaging module) | Customers awaiting response, Sales activity |
| Settings: fixed overhead, weekly marketing spend, overhead per billable hour (already exist, see pl-vs-settings-overhead-calibration.md) + new `sales_targets`, `marketing_spend` | P&L, Marketing, targets |
| `lib/invoicing/attention.ts` + the PC Command queue evaluator | The "needs doing now" strip at the top of every view |

Two rules from `decisions-and-rulings.md` govern the whole build:

- **One source of truth.** No dashboard section builds its own list, badge or queue. Counts are computed by shared functions in `lib/reporting/` and the existing attention evaluators; the same function feeds the tile, the click-through list and the CSV export, so the three can never disagree.
- **Nothing typed in.** Every number is derived from events and state. There are no "status" dropdowns on this page. Stage words like "wrapping up" stay derived, never stored.

The 2 Sep design question (owner page vs PC page) is now settled by Tom: **one home page, different views per role.**

---

## 1. Rulings from Tom (19 Sep 2026) — do not revisit

1. Home page for every staff member; each staff role sees a different set of sections.
2. Eight sections: Sales · Sales activity · PC Command activity · Invoicing · Contractor · P&L · Where estimates go · Marketing.
3. Every PC Command tile is clickable and opens the underlying records.
4. Average order value is categorised by the presentation attached to the estimate (commercial, residential exterior, residential interior…). Adding a presentation adds a category automatically.
5. Monthly sales target lives in Settings; the dashboard shows $ and % of target hit, month by month.
6. P&L runs off the existing Settings overhead figures now and switches to MYOB after the integration (see myob-integration.md).
7. "Revenue received" in P&L is the payment-received status change in invoicing — not the invoice date.
8. Everything filters by date; anything list-shaped exports to CSV. Built to be extended, not replaced.

---

## 2. Roles and views

The platform currently has three auth roles (staff / contractor / customer). Staff needs sub-roles for this page. ⚑1 asks Tom to confirm the names; the build uses these:

| Staff role | Sections shown (in this order) | Notes |
|---|---|---|
| **Owner / admin** | Needs doing · Sales · P&L · Invoicing · Where estimates go · Marketing · PC Command · Contractor · Sales activity | Only role that sees margins, P&L, targets and marketing spend |
| **PC** | Needs doing · PC Command · Contractor · Sales activity (job events only) | No $ margin anywhere; sees job values because work orders already show them |
| **Sales / estimator** | Needs doing · Sales · Where estimates go · Sales activity · Pipeline | Sees own figures by default with a "whole team" toggle; no margin |
| **Office / finance** | Needs doing · Invoicing · PC Command (customers awaiting response only) · Sales activity | No margin, no P&L |

Rules:
- Role gates are enforced **server-side** in the reporting functions (a sales login calling the P&L endpoint gets 403, not an empty tile). RLS alone is not enough because these are aggregates.
- A section a role cannot see is absent from the page, not greyed out.
- Roles are stored on `staff_profiles.staff_role` (new column, enum `owner | admin | pc | sales | finance`), editable in Settings → Team by owner/admin.

---

## 3. Page architecture

**Header, on every view:**
- Date range control: This month · Last 30 days · This quarter · Year to date · Custom. Default = this month. The header always prints the exact dates and the comparison period in words ("1–19 September 2026, compared with 1–19 August").
- Comparison toggle: previous period / same period last year / none.
- "Export" on each section: CSV of the rows behind it, with the date range and role baked in server-side.

**Two kinds of tiles, visibly different:**
- **Period tiles** — counts and sums of events inside the date range (sales, revenue, views). They change when the filter changes.
- **Right-now tiles** — state counts (jobs to schedule, invoices overdue, contractors silent). These ignore the date filter and say so in their subtitle ("right now"). Mixing the two is the commonest dashboard bug; keep them in separate rows.

**Every tile is a link.** Tapping opens a filtered list of the records that make up the number, with the same date range, sortable, exportable. The list is the drill-through; there is no separate "report" page.

**Definitions in the UI.** Each tile has an "i" that reveals a one-sentence plain-English definition (copy is in §4). The definition text lives next to the function that computes the number, so they change together.

**Needs doing strip.** Top of every view, above the sections: the role's attention cards from the shared evaluators (invoicing attention for finance/owner, PC Command queue for PC/owner, sales follow-ups for sales). This is not a ninth section and not a new list — it renders what the existing evaluators return. The dashboard being "the home page for everybody" only works if the first thing on it is what each person should do next.

**Mobile first.** Tom reviews on his phone; PCs and estimators are in the field. Single column under 760px, tiles in a 2-up grid, charts as inline SVG that scale.

---

## 4. Sections and definitions

Format: **Metric** — definition (source) — drill-through opens — kind.

### 4.1 Sales

| # | Metric | Definition | Drill-through | Kind |
|---|---|---|---|---|
| 1 | Total estimates | Estimates **sent** in the period (`estimate_sent` event). Drafts never count. Sub-line: created but not sent. | Estimates list, sent in range | Period |
| 2 | Total sales $ | Sum of estimate totals **inc GST** with `estimate_accepted` in the period, dated on acceptance. Includes manually accepted PaintScout imports. Approved variations shown as a separate sub-line, not folded in. | Accepted estimates | Period |
| 3 | Total sales (number) | Count of the above | Same list | Period |
| 4 | Average order value by category | Total sales $ ÷ count, grouped by the estimate's presentation category (§5.3). Show **median alongside mean** — commercial jobs drag the mean. "No presentation" appears as its own row so gaps are visible, not hidden. | Accepted estimates filtered to that category | Period |
| 5 | Target hit | $ and % of the month's `sales_targets` value reached by accepted sales; a pace marker showing where the month should be by today; a 12-month bar chart of target vs actual. | Month list with target, actual, variance | Period (month) |
| 6 | Conversion | Accepted ÷ sent, **cohort by month sent** (see ⚑4). Shows "still open" count inside the 60-day window. | Sent estimates with outcome column | Period |
| 7 | By salesperson | Rows 1–3 and 6 per staff member who sent the estimate. Default view for the sales role is "mine". | Estimates for that person | Period |

Added by Claude (§7 explains why): 6 and 7. Conversion was in the 2 Sep list and dropped in the 19 Sep list — it is the single most useful sales number, so it stays.

### 4.2 Sales activity

One timeline, newest first, read from `estimate_events`, `crm_events`, messages and `invoice_events`. Each row: time, who, what, which estimate/job, and one contextual line (value, suburb, days to expiry).

Events in scope: estimate sent · viewed (with view count) · downloaded (PDF) · accepted · declined · question asked · message read by customer · message received from customer · message sent by staff · wizard estimate saved (no request) · visit requested · payment received · expired.

Filters: by event type, by salesperson, by customer. The PC view shows job events only; the sales view shows estimate and message events. Export = the filtered rows.

### 4.3 PC Command activity

All right-now tiles. All counts come from the PC Command queue evaluator already specified in `claude-code-brief-wo-loop-pc-command.md`; this section renders counts and links into the console's filtered lists. If a count needs a query the evaluator does not have, add it to the evaluator, not to the dashboard.

| # | Tile | Definition | Opens |
|---|---|---|---|
| 1 | Jobs to schedule | Accepted estimates with no accepted booking (includes the imported "Unscheduled" folder). Sub-line: $ value and oldest acceptance date. | Scheduling board, unscheduled filter |
| 2 | Jobs in progress | Work orders in `in_progress`. Sub-line: how many are wrapping up (all surfaces done). | Console flow view, in-progress lane |
| 3 | Requiring quality check | Work orders at `qa` stage plus scheduled QA checks due today or overdue. | QA list |
| 4 | Variations requested | `wo_variations` raised and not yet approved/declined, split: awaiting office pricing / awaiting customer. | Variations list |
| 5 | Customers awaiting response | Threads whose last message is from a customer with no staff reply, with the oldest wait time shown. Only counts messages inside the platform (email replies land through the messaging adapter). | Message threads, oldest first |
| 6 | Awaiting sign-off | Work orders at `walkthrough` stage; sub-line: walkthroughs booked today, overdue. | Walkthrough list |
| 7 | Materials budget vs actual | Per job: estimate materials line (from `wo_snapshot.materials`) vs matched materials costs from `cost_intake`. Tile shows the period total and % variance; the list shows every signed-off job in range with its variance, worst first. Jobs with unmatched costs are marked, not guessed. | Job costs list |

Added by Claude: **8 — Contractor offers past SLA** (offers older than 24h without a response, with the re-offer action) and **9 — Starting this week with colours TBC** (the named blocker from the pre-start checklist). Both already exist in the console queue; surfacing them on home stops a PC missing them.

### 4.4 Invoicing

Reads only through `lib/invoicing/ledger.ts` and the invoicing dashboard's existing queries. Money in cents, displayed inc GST with GST shown on drill-through.

| # | Metric | Definition | Opens | Kind |
|---|---|---|---|---|
| 1 | Received | Sum of `payments` received in the period (customer payments only). | Payments list | Period |
| 2 | Outstanding | Issued invoices not fully paid, not yet past due date — number and $. | Receivables, outstanding filter | Right now |
| 3 | Overdue | Issued invoices past due date — number and $, with aged buckets 1–7 / 8–30 / 31+ days. | Receivables, overdue, chase-order sort | Right now |
| 4 | Contractor invoices outstanding | Approved contractor invoices not yet marked paid — number and $. Sub-line: awaiting approval. | Payables | Right now |
| 5 | Revenue by payment type | Received in period split by `payments.method`: card (Stripe) / bank transfer / **cash** (⚑7 — cash is not a method today). Surcharge shown separately. | Payments filtered by method | Period |
| 6 | Unsent invoices (pipeline) | Accepted jobs with money not yet invoiced: deposit drafts unissued, progress not yet requested, finals drafted after sign-off but unissued. Number and $, split by stage. | Invoice pipeline list | Right now |

Added by Claude: **7 — Deposits unpaid with a start date inside 7 days** (the critical card from `attention.ts`, shown as a count) and **8 — Average days to pay** for finals in the period (tells Tom whether the chase ladder is working).

### 4.5 Contractor

| # | Metric | Definition | Opens | Kind |
|---|---|---|---|---|
| 1 | Finished on time | Jobs where all surfaces reached DONE on or before the booked end date ÷ jobs finished in the period, number and %. Per contractor in the drill-through. Booked end date = the accepted booking's last day, adjusted by approved extensions (⚑8). | Finished jobs with booked vs actual dates | Period |
| 2 | Silent for 3+ days | Contractors with an in-progress job and no event of any kind (tick, photo, update, message, expense) in 3 days. Threshold in Settings. | Contractor list with last-seen | Right now |
| 3 | QA passed first time | `wo_qa_checks` passed on first check ÷ checks in period, number and %. Per contractor in drill-through; fails link to the rectification items. | QA checks list | Period |

Added by Claude: **4 — Offers accepted within 24h** (number and %), **5 — Variations raised per job** (a contractor raising many small variations is a scoping or a behaviour problem — either way Tom wants to see it), **6 — Expense claims awaiting approval**. Ratings stay internal; nothing here is ever shown to customers (ruling: painter ratings not public).

### 4.6 P&L

Owner/admin only. Ex GST throughout, labelled. Runs off the three Settings overhead values now; the MYOB integration replaces the overhead and marketing inputs with actuals and this section keeps its shape.

| # | Metric | Definition |
|---|---|---|
| 1 | Agreed sales | Two figures side by side: **contracts signed** (accepted estimates in period, ex GST) and **revenue received** (payments received in period). They are different things and the gap between them is the cash pipeline. |
| 2 | Gross profit margin | On jobs **signed off** in the period: revenue ex GST less contractor offers, materials, pass-throughs and reimbursed expenses. Shown as actual next to estimated (the engine's margin at acceptance) with the gap in points. Drill-through: per-job est vs actual, the calibration table Tom has asked for since the fixed-price-era analysis. |
| 3 | Net profit margin | Gross profit less overhead for the period. Overhead = Settings fixed overhead × weeks in period + Settings weekly marketing × weeks (marketing counted here so it is not lost, and not double-counted with 4.8). Shown with a "Settings basis" chip until MYOB actuals replace it. |
| 4 | Materials | Materials as % of revenue, estimated vs actual, and the $ variance. Same source as PC tile 7, so the two always match. |

Added by Claude: **5 — Margin by job size band** (under $2k / $2–4.5k / $4.5–12k / over $12k — the $2–4.5k band was the weakest at 25.9% and needs watching) and **6 — Margin by category** (the presentation categories from Sales, so residential interior/exterior/commercial margins are visible, not just AOV).

### 4.7 Where estimates go

As advised on 2 Sep and shown in the mockup: wizard started → email captured → estimate saved → sent → viewed → accepted, with counts, drop-off between steps, and what each drop-off means ("no email — nothing to chase" / "email, not sent — warm leads"). Sub-lines: self-serve accepted without a visit; median days sent-to-accepted. Reads `wizard_sessions` buckets (A/B/C/C+/D from the wizard-progress brief) and `estimate_events`. Staff-built estimates enter at "saved". Drill-through on any step opens those estimates or sessions. Filter by source (§4.8) so the funnel can be read per channel.

### 4.8 Marketing

Owner/admin only. Depends on `lead_source` being captured on every estimate and account (the CRM brief captures it now; reported reliably from the new-website launch). Categories: Google search · Google Ads · Instagram · Facebook · Referral · Repeat customer · Real estate / trade · Word of mouth · Other (⚑5).

| # | Metric | Definition |
|---|---|---|
| 1 | Estimates by lead source | Sent estimates in period grouped by source; accepted count alongside so conversion per source is visible. |
| 2 | Cost per acquisition | `marketing_spend` for the period (§5.2) ÷ accepted estimates. Blended always; per channel only where spend is recorded against that channel. |
| 3 | AOV per lead source | Accepted value ÷ accepted count per source, mean and median. |
| 4 | Revenue per lead source | Accepted value per source in period; sign-off revenue per source in the drill-through. |
| 5 | Spend vs sales | Marketing spend ÷ accepted sales $ as a %, and the 12-month trend. Same Settings weekly figure the P&L uses until `marketing_spend` rows exist for the month. |

Added by Claude: **6 — Wizard starts by source** (the top of the funnel per channel, from `wizard_sessions`) and **7 — Repeat and referral share** of accepted sales, which is the number that says whether the referral programme (campaign studio brief) is working.

---

## 5. Data model additions

### 5.1 `lib/reporting/` — the only place numbers are computed
- One pure function per metric: `(range, compareRange, roleContext, filters) → { value, compare, rows }`. Tiles read `value`, drill-throughs and exports read `rows`. Golden tests per function on a fixed seed dataset (same pattern as `lib/pricing`).
- Period functions read event logs. Right-now functions read state. A function is one or the other, never both; the type says which.
- Role check inside the function, not at the route.
- Definitions live as a string constant beside each function and are served to the UI.

### 5.2 New tables (all Settings-editable by owner/admin)
- `sales_targets (month, target_cents, category nullable, salesperson nullable)` — one row per month; optional per-category and per-person rows roll up.
- `marketing_spend (month, channel, spend_cents, note)` — typed monthly for now; the MYOB sync and ad-platform connectors write here later. Until a month has rows, the Settings weekly marketing figure × weeks is used and the tile says so.
- `staff_profiles.staff_role` (§2).
- Settings values: contractor silent threshold days (3), overdue aged bucket edges, funnel idle definition (reuse the wizard-progress idle threshold, do not add a second one).

### 5.3 Categories from presentations
- `presentations.category_label` (text, defaults to the presentation name). Sales, P&L and Marketing group by this label, not by presentation id, so rewriting a presentation does not split history and two presentations can share a category. Adding a presentation still creates a new label automatically (ruling 4). Estimates with no presentation report as "Uncategorised". ⚑3.

### 5.4 Rollups
- `metrics_daily` materialised nightly (and on demand after a backfill) for period metrics over 90 days; short ranges compute live. Right-now tiles always compute live — they are counts on indexed state and must be fast without rollups.
- Nightly job runs after the existing `/api/cron/wo-sweep`; same CRON_SECRET pattern.

### 5.5 Export
- One server route: `/api/reporting/export?metric=&from=&to=&filters=` streaming CSV; the route calls the same `lib/reporting` function and writes `rows`. Filename = metric + range. Role enforced by the function. No client-side CSV.

---

## 6. Sessions (copyable, in order)

Kickoff ritual applies: commit the reference files, confirm the file list back, then code. Stop and report on any missing reference.

**Session 1 — Reporting core and roles.** `staff_role` column + Settings → Team; `lib/reporting/` skeleton with period/right-now types, role gating, definition strings; `metrics_daily` rollup + cron; export route; `/home` shell with header (range, comparison), role-driven section list, Needs-doing strip wired to the two existing attention evaluators. E2E: three logins land on three different homes; a sales login hitting the P&L function gets 403.

**Session 2 — Sales + Where estimates go.** Metrics 4.1.1–7, presentation `category_label`, `sales_targets` Settings screen and target tile with pace marker, funnel from `wizard_sessions` + `estimate_events`, drill-through lists, exports. Golden tests on a seed of 60 estimates across three categories and two salespeople.

**Session 3 — PC Command + Contractor.** Counts 4.3.1–9 rendered from the console evaluator (extend the evaluator where a count is missing), materials est vs actual function shared with P&L, contractor metrics 4.5.1–6 with per-contractor drill-through. E2E as PC: every tile opens the right filtered list and the count matches the list length.

**Session 4 — Invoicing.** Metrics 4.4.1–8 via `ledger.ts`; add `cash` to `payments.method` if ⚑7 rules yes; aged buckets; invoice pipeline list. Tests assert the home tiles equal the /invoicing dashboard pulse tiles for the same instant (they share functions, so this is a tripwire, not a coincidence).

**Session 5 — P&L + Marketing.** `marketing_spend` table and Settings screen; P&L metrics 4.6.1–6 on the Settings basis with the basis chip; lead-source metrics 4.8.1–7; per-job est-vs-actual margin table. Owner-only gate tests.

**Session 6 — Sales activity + polish.** Unified timeline with type/person/customer filters, role-scoped event sets, export; definitions "i" on every tile; comparison arrows; mobile pass on a real phone; help file `docs/help/dashboard-<role>.md` per role (help content brief: help file is part of definition of done).

**Session 7 — Full e2e and performance gate.** One scripted day: estimate sent → viewed → accepted → booked → ticks → variation → sign-off → invoice → payment, then assert every affected tile moved by exactly the expected amount for every role. Load test on the 25k-account seed dataset from the portal brief: home renders under 1.5s on the seed, exports of 10k rows stream without timeout.

---

## 7. Claude's additions and why (Tom asked)

Beyond the metrics added inside each section above:

1. **Needs doing strip on every view.** A home page that is only numbers makes people open a second page to work. The strip is zero new logic — it is the existing attention evaluators rendered at the top.
2. **Conversion rate and per-salesperson rows** back into Sales. With an estimator coming on to sign pre-qualified work, Tom needs to see each person's sent/accepted/conversion, and conversion is the number that tells him whether the wizard is pre-qualifying properly.
3. **Booked work ahead** (accepted, not started: $ and weeks of work at current run-rate) and **starts this week** on the PC view. Together with "jobs to schedule" this is the capacity picture — whether to recruit contractors or push sales.
4. **Open pipeline** on the sales view: sent-awaiting-answer $, expiring within 14 days, visit requested not booked, warm leads. The expiring list is a daily call list.
5. **Estimate accuracy** on the owner view: estimated hours vs contractor worked hours, and median $ correction at staff review against the $150 target. This is the unmet Phase-1 gate made visible; it should sit on the home page until it is green.
6. **Customer service row** (owner and office): first-reply time to customer messages (median, working hours), enquiry-to-estimate-sent time, reviews requested → received, warranty call-backs. Response time was in Tom's 2 Sep list and belongs with the customers-awaiting-response count.
7. **Margin by job band and by category** in P&L — the $2–4.5k band problem is only fixable if it stays visible.
8. **Anomaly flags, not just numbers.** Any period tile more than 25% off its comparison gets an amber marker and shows in the Needs-doing strip for the owner ("Conversion down 31% vs last month"). Threshold in Settings. Cheap to build on top of the comparison values already computed.
9. **Saved views later, not now.** Custom dashboards per person are a later brief; role views plus filters cover the next year. Noted so nobody builds a drag-and-drop tile editor.

Deliberately not added: forecasting, cash-flow projection, contractor leaderboards visible to contractors, anything that writes state.

---

## 8. Acceptance criteria

1. Every tile's number equals the row count or sum of its drill-through list for the same range and role — asserted by tests for every metric.
2. Home tiles that overlap the /invoicing dashboard and the PC Command console show identical values at the same instant (shared functions; tests compare them).
3. Period tiles change with the date filter; right-now tiles do not, and each right-now tile says "right now" in its subtitle.
4. Role gating is server-side: each of the five roles has an e2e run that asserts which sections render and that the hidden sections' functions return 403.
5. No margin, GP, net, target or marketing-spend figure is reachable by PC, sales or finance roles through any route, export or drill-through.
6. Every list exports to CSV through the single server route; exported row count equals the on-screen count; exports respect role and range.
7. Adding a presentation in Settings makes its category appear in Sales AOV, P&L by category and Marketing without code changes.
8. Setting a monthly sales target makes the target tile, pace marker and 12-month chart update; a month with no target shows "no target set", not 0%.
9. Sales activity shows an estimate view within 5 seconds of the view-tracking event landing.
10. Materials est vs actual in PC and P&L are the same function and agree to the cent; jobs with unmatched intake are marked, never estimated.
11. Contractor "silent 3+ days" only counts contractors with an in-progress job; the threshold is a Settings value.
12. Money is integer cents end to end; GST shown ex/inc as specified per section and labelled on every tile.
13. Home renders under 1.5 s on the 25k-account seed; no query reads full `wo_snapshot` rows (S5 lesson).
14. Definitions are served from the same module as the functions; a metric with no definition string fails a unit test.
15. Help files exist for each role and describe every tile in plain English.

---

## 9. ⚑ Decisions for Tom

1. **Staff sub-roles** — owner / admin / pc / sales / finance as named here? Does the office admin get the finance role or a separate one? Can a person hold two (e.g. Tom = owner, an estimator who also PCs)?
2. **Who sees $ at all** — the build hides margin/P&L/targets/marketing from everyone except owner/admin, and shows job values to PC and sales. Confirm, or name exceptions.
3. **Category source** — group by a `category_label` on the presentation (default = its name) so rewrites don't split history. Alternative is grouping by presentation id exactly as worded. Recommend the label.
4. **Conversion attribution** — cohort by month sent (recommended; the "still open" count keeps it honest) or by month accepted. Left open since 2 Sep.
5. **Lead-source list** — confirm the nine sources in §4.8, and whether trade/real-estate clients are a source or an account type (they are both; recommend treating them as account type and reporting them in the category split, with "Referral — trade" as a source).
6. **Marketing spend** — typed monthly per channel in Settings from now, replacing the weekly Settings figure once a month has rows. Confirm, and who enters it.
7. **Cash payments** — add `cash` as a payment method (recorded by staff, no receipt automation)? If Paint Group does not take cash, drop it from the revenue-by-type tile rather than show a permanent zero.
8. **"Finished on time" clock** — booked end date from the accepted booking, adjusted by approved extensions, vs the day all surfaces hit DONE. Or vs sign-off date? Recommend all-surfaces-DONE (the contractor controls it; sign-off timing depends on the customer).
9. **Silent contractor threshold** — 3 days as stated; calendar days or working days?
10. **Anomaly threshold** — 25% swing vs comparison as the amber trigger, or a different figure?
11. **Targets by category and salesperson** — build the optional per-category/per-person target rows in v1, or month total only?
12. **Net margin basis** — until MYOB, net = GP − (fixed overhead + weekly marketing) × weeks. Include the overhead-per-billable-hour figure anywhere, or leave it to the estimator only? Also confirm Decision 2 from the P&L reconciliation (the subscriptions line split) since it moves the marketing figure.

Blocking for session 1: ⚑1 and ⚑2. Everything else has a stated default and can be corrected later without rework.

---

## 10. Reference files (commit first, confirm back)

- `docs/briefs/claude-code-brief-home-dashboard.md` — this file
- `design/reference/owner-dashboard-mockup.html` — tiles, funnel, revenue/margin chart, activity feed
- `docs/briefs/claude-code-brief-wo-loop-pc-command.md` — console queue evaluator, six-stage model, `wo_events`
- `docs/briefs/claude-code-brief-invoicing-payments.md` (with cost-capture §6.5) — `ledger.ts`, `attention.ts`, `payments.method`, `cost_intake`
- `docs/briefs/acceptance-to-paid-workflow.md` — money phases G0–G7, chase ladder
- `docs/briefs/claude-code-brief-crm-retargeting.md` + `wizard-progress-crm-buckets-brief.md` — `crm_events`, `wizard_sessions`, lead-source capture
- `docs/briefs/claude-code-brief-customer-portal.md` — identity model, 25k-account seed dataset
- `docs/briefs/claude-code-brief-presentations.md` — presentations, one ticked per job type
- `docs/pl-vs-settings-overhead-calibration.md` — the three Settings overhead values and their P&L basis
- `docs/briefs/claude-code-brief-help-content-foundation.md` — help file per role as definition of done
- `docs/briefs/claude-code-brief-airtable-crm-import.md` — imported accepted jobs and the Unscheduled folder
- `decisions-and-rulings.md` and `CLAUDE.md` — one-source rule, stop-and-report, migrations between gate runs
