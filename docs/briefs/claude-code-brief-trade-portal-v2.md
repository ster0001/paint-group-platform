# Build brief — Trade portal v2 ("the property is the spine")

**Project:** paint-group-platform (Next.js 16 App Router / Supabase)
**Author:** Tom (via Claude) · **Date:** 30 Aug 2026 · **Supersedes:** session 7 ("commercial workspace") of `claude-code-brief-customer-portal.md`. Sessions 3a-1 → 6 and 8 of that brief stand.
**Status:** Awaiting Tom's rulings on the ⚑ items in §8, then commit.

---

## 0. Kickoff ritual (do this first, before any code)

1. Commit this brief to `docs/briefs/claude-code-brief-trade-portal-v2.md` and the mockup to `design/reference/trade-portal-v2-mockup.html`.
2. Read every file in §2. **Missing reference = STOP and report** (CLAUDE.md rule). Do not proceed on assumptions.
3. Confirm the file list back to Tom before writing code.
4. Run session 0 (diagnostic, read-only) and report findings before session 1.

## 1. Why we're revisiting

The trade portal as built treats a commercial client as "a residential customer with more jobs". Three symptoms Tom has seen:

- The colour register is not showing the colours that were actually used.
- Every colour for every property lands in one list, so a client with several properties can't tell which colour belongs where.
- There is no job timeline for trade clients — residential customers get progress updates with photos; commercial clients, who have the most reason to want them, get nothing.

The fix is a model change, not three patches. Real estate agents think in **properties and owners**, facilities managers in **sites and POs**, insurers in **claims**. All three want the same four things per property: what's happening, what colours are on the walls, what do I owe, and where are the documents. The portfolio view is those properties with live status; the organisation layer (people, approval rights, notification routing, references) sits on top.

**Design intent (from Tom's stated bar):** out-of-this-world, usable by a 60-year-old, makes commercial clients never look elsewhere. The measure is *time to answer* — "what colour is the hallway at 14 Beaumont St" and "is Ormond Rd finishing Monday" must each be answerable in under 10 seconds from a cold open on a phone.

## 2. Reference files (read all)

| File | Why |
|---|---|
| `CLAUDE.md` | Standards; stop-and-report rule; e2e-in-real-role law |
| `docs/briefs/claude-code-brief-customer-portal.md` | Identity model (accounts / account_users / properties), sessions 3a-1 → 8. This brief replaces session 7 only |
| `docs/briefs/customer-identity-link.md` | Why `customer_id` linking exists and its current state |
| `docs/briefs/work-order-completion-workflow.md` (+ brief v4) | Six-stage WO model, `wo_events` as source of truth, surface ticks, pre-start "colour schedule finalised" item, PC-approved daily updates |
| `docs/briefs/claude-code-brief-wo-loop-pc-command.md` | Event log shape, `view=` param rule (never role-inferred) |
| `docs/briefs/claude-code-brief-invoicing-payments.md` | Invoice entities, customer token link, ledger — trade money view reads these, never recomputes |
| `docs/briefs/acceptance-to-paid-workflow.md` v2 | Money phases; trade terms flag |
| `design/reference/trade-portal-v2-mockup.html` | **This brief's mockup.** Portfolio · Property (Progress/Colours/Money/Documents) · Timeline · Approve · Money · Team; persona switch shows how reference labels change |
| Existing portal mockup html + experience map v2 | Residential portal — the timeline component you will reuse lives here |
| `lib/pricing/*`, `lib/invoicing/ledger.ts`, `lib/invoicing/attention.ts` | Money and attention logic that must not be duplicated |
| Any existing `colour*` / `paint_schedule*` migration, table, RPC or component | Session 0 traces these |

If any of the above does not exist under that name, find its equivalent and list what you used — or stop.

## 3. Session 0 — Diagnose the colour register (read-only, report before fixing)

Trace two paths and report where they diverge. Do not change code in this session.

**Write path.** Where does a colour become "the colour used on this surface"? Candidates: the estimate's paint preferences (wizard/editor), the pre-start checklist's "colour schedule finalised" item, the materials section (surface→product aggregation), the painter's DONE tick, a staff edit. Report which of these actually writes a row, to which table, keyed by what (`estimate_id`? `job_id`? `property_id`? `account_id`?), and what fields it carries (brand / product / colour name / colour code / sheen / coats / applied date / area).

**Read path.** What does the portal's Colours view query, scoped by what, and how does it label rows? Report the exact query and scope.

**Hypotheses to confirm or rule out** (these are guesses — I have not read the code):
- H1 — Portal reads estimate paint *preferences*, not the finalised schedule, so anything changed at pre-start or on site never shows.
- H2 — Rows are keyed to `account_id` (or filtered by account) with no `property_id`, which is exactly why all properties merge into one list.
- H3 — Area/surface names are dropped between the estimate tree and the colour rows (rows say "Walls" with no room/elevation).
- H4 — "TBC — consult booked" colours are stored as a placeholder string and shown as if real.
- H5 — Product (e.g. Wash & Wear) and colour (e.g. Natural White) are conflated into one field; sheen missing.
- H6 — Materials aggregation is being used as the register; it holds *what was ordered*, not *what went on which wall*.

**Deliverable:** `docs/audits/colour-register-diagnostic.md` — write path, read path, which hypotheses held, and a proposed minimal migration for session 1. Wait for Tom.

## 4. Data model (session 1)

Builds on the customer-portal identity model. Nothing here changes residential behaviour — residential accounts already hold multiple properties (ruled 26 Aug); this adds organisation features on top.

### 4.1 `colour_records` (new, or migrate the existing table to this shape)

One row per **surface group at a property**, carrying provenance.

| column | notes |
|---|---|
| `id`, `property_id` (FK, NOT NULL), `account_id` (denormalised for RLS) | property is the key, never the account alone |
| `area_label` | "Walls — all rooms", "Front door (exterior face)", "Bedroom 1 ceiling"; derived from the estimate tree grouping used on work orders (elevation for exterior, room/surface-group for interior) |
| `surface_type` | wall / ceiling / trim / door / window / fascia / … (existing enum) |
| `brand`, `product`, `colour_name`, `colour_code`, `sheen`, `coats` | separate fields; `colour_code` is the manufacturer code (e.g. Dulux SW1 P4) |
| `swatch_hex` | nullable; from product catalogue if present, else null (UI falls back to neutral) |
| `status` | `planned` (finalised schedule, not yet applied) · `applied` · `superseded` |
| `applied_from`, `applied_to` | set from first/last DONE tick of surfaces in the group |
| `source_job_id`, `source` | `colour_schedule` · `wo_tick` · `staff_edit` · `historical_import` |
| `superseded_by` | nullable self-FK — old records are never deleted or overwritten |

**Rules**
- Rows are created when the pre-start checklist item *colour schedule finalised* completes (status `planned`). Not before. Estimate preferences never write here.
- A surface DONE tick flips the matching row to `applied` and stamps dates. If the painter records a different product at tick time (existing tick data model — check), the row is updated and the change logged to `wo_events`.
- A new job at the same property that repaints a surface group creates a new row and marks the old one `superseded` with `superseded_by`. History stays.
- `TBC` colours are **not** rows. The property Colours tab shows an amber "Colours to be confirmed — consult booked" card read from the WO's TBC state instead.

### 4.2 Organisation layer

| table | notes |
|---|---|
| `accounts` | existing; `account_type = trade` already exists. Add `org_kind` enum: `real_estate` · `facilities` · `insurance` · `builder` · `body_corporate` · `other` (drives reference labels + defaults only, never permissions) |
| `account_users` | existing; add `role` enum `admin` · `approver` · `viewer` · `finance`; `property_scope` (`all` \| array of property ids); `approval_limit_cents` nullable |
| `property_references` | `property_id`, `label`, `value` — e.g. Owner / Your ref / PO / Site code / Claim no. / Assessor. Label set defaults per `org_kind`, editable. Every invoice, estimate, report and email for that property prints these |
| `external_approvals` | `estimate_id`, `sent_by_user_id`, `approver_name`, `approver_email/phone`, `token`, `viewed_at`, `decided_at`, `decision`, `signer_name` — the "send to owner / assessor to approve" flow (§6) |
| `notification_prefs` | per `account_user`: daily digest time, approvals channel (email / SMS / both), invoices routing |

RLS: a trade user reads a property, its jobs, colour records, invoices, documents and timeline events **only via** `account_users.property_scope`. `finance` role reads invoices/statements and property references but **not** job detail or photos. Server actions take explicit `view=trade` — never role-inferred (existing rule).

## 5. Screens (map 1:1 to the mockup)

### 5.1 Portfolio (`/portal` for trade accounts)
- Header: org name, today, "N jobs on site this week" (derived from WO stage).
- Four pulse tiles: on site now · need your approval · ready to sign off · invoices overdue. Each tile is a filter on the list below. Numbers read from the model — no typed statuses.
- **Needs you** queue: reuse `lib/invoicing/attention.ts` shape and add job-side items (estimate awaiting approval, variation awaiting approval, walkthrough booked, deemed-clock nudges if enabled). One primary action per card. Same "one source rule" as the PC console.
- Property cards: address · status chip (derived) · reference line (labels from `property_references`) · **swatch strip** (the property's current `applied`/`planned` colour records, in surface order walls→ceilings→trims→doors) · one-line derived summary · progress bar from surface-tick ratio. Cards with no active job show "Colour card on file · request a touch-up or new estimate".
- Search by address, reference value, or job number. Sort: needs-you first, then on-site, then recent.
- "+ Add a property" opens the property form and, if the user wants, straight into the embedded estimate builder (session 6 of the portal brief) with the property pre-filled.

### 5.2 Property (`/portal/properties/[id]`)
Tabs: **Progress · Colours · Money · Documents.**
- Progress: current job card (six-stage rail, painter name + rating, start/expected finish, surfaces done N of M), "Open full timeline", "talk to us" strip with PC name and phone, job history at this property with completion-report links.
- Colours: one card per `colour_records` row for this property — swatch (hex or neutral) with colour code, area label, status chip (Applied / In progress / Scheduled / Previous), brand + colour name + sheen, product + coats + dates. Superseded rows shown dimmed under "Previous". Actions: **Download colour card (PDF)**, **Request a touch-up** (opens the embedded builder with the property and these products pre-filled; ⚑ what it creates). TBC card as per §4.1.
- Money: this-job total inc GST, paid so far, invoices at this property (each carries property references), **Statement for this property (PDF)**. Reads the invoicing ledger; computes nothing.
- Documents: per-property (completion reports, warranty certificates, approved estimates, SWMS) then "About Paint Group" (public liability certificate, WorkCover, warranty terms — the insurances-on-file space ruled 26 Aug).

### 5.3 Timeline (`/portal/properties/[id]/jobs/[jobId]`)
**Reuse the residential customer timeline component unchanged.** Same six-stage rail, same day-grouped events from `wo_events`, same PC-approved daily updates, same photo gating, same variation cards, same walkthrough/sign-off events. The only change is data scoping (organisation → property → job) and the back link. If the component is coupled to residential routing or to a single-property assumption, extract it to a shared location first and cover it with the existing tests — do not fork it.

Events surfaced to trade users additionally include: "Colours confirmed & paint ordered" (pre-start completion), "Painter confirmed" (booking accepted), and external-approval events ("Sent to owner", "Owner approved").

### 5.4 Approve (`/portal/approvals/[estimateId]`)
Renders the existing customer estimate view (the estimate builder *is* the document) with a trade action strip that depends on `org_kind` and the user's role/limit:
- Approve (within limit) · **Send to [owner / colleague / assessor] to approve** · Ask a question or request a change.
- Colours block: "Repeat the colour card on file for this property" defaults on when applied records exist; changeable until pre-start.
- Approval by a user over their `approval_limit_cents` is blocked or warned (⚑).
- Facilities kind: PO number field required on approve (⚑ required vs optional).
- Insurance kind: claim number is a property reference and prints on the estimate, before photos, variations, completion report and invoice.

### 5.5 External approval (token link, no login)
Reuses the customer token-link flow (SMS/email, view tracking). Approver sees the same estimate document, the property references, and Approve / Decline / Ask. Type-to-sign with signer name. Decision writes `external_approvals` and a `wo_events`/estimate event; the sender is notified and the Needs-you card clears. Expiry = estimate validity.

### 5.6 Money (portfolio, `/portal/money`)
Outstanding / overdue tiles, receivables list grouped by property with references on every line, Statement PDF, CSV export (columns: property, references, invoice no., issued, due, amount inc GST, GST, paid, status). `finance` role lands here.

### 5.7 Team (`/portal/team`)
People list with role, property scope, approval limit; invite by email; notification routing (daily digest time; approvals email/SMS; invoices to a finance address). Admin only.

## 6. Copy rules
English (not Australian) tone, sentence case, plain verbs, no filler. Buttons name the outcome ("Approve on behalf of the owner", "Send to owner to approve"). Money always `$X,XXX.XX inc GST`, Martian Mono. Never show system words (RPC, stage enum, RLS). Empty states direct: "No colours on record yet — they'll appear here the day each surface is finished."

## 7. Sessions & acceptance criteria

Each session ends with a green typecheck/lint/unit run and the e2e listed. e2e runs **as a real trade-role user** against the dedicated test project (S7 fix), never production.

| # | Session | Done when |
|---|---|---|
| 0 | Colour register diagnostic (read-only) | `docs/audits/colour-register-diagnostic.md` committed; hypotheses H1–H6 each marked held / not held with evidence; Tom has replied |
| 1 | Schema: `colour_records` + org layer + RLS + backfill | Migrations pasted by Tom between gate runs; backfill script reconstructs `colour_records` for every closed job from its finalised schedule/ticks and reports rows it could not attribute; RLS test proves user A of org X cannot read any row of org Y and a `finance` user cannot read photos/events; 100% of rows have `property_id` |
| 2 | Write path: pre-start → `planned`, DONE tick → `applied`, repaint → `superseded` | Unit tests for each transition; e2e: run a WO through pre-start and ticks, assert the property Colours tab shows the finalised colour (not the estimate preference) with correct area label, sheen and dates; a second job at the same property supersedes without deleting |
| 3 | Portfolio + Property screens (Progress / Colours / Money / Documents) | Mockup parity walk on a phone; swatch strip and progress bar derive from data (assert by changing a tick and reloading); a seeded org with 40 properties renders the portfolio in <1.5 s on the volume dataset; every property card's reference labels follow `org_kind` |
| 4 | Timeline reuse | The residential timeline component is imported from one shared location by both portals; snapshot test proves identical output for the same `wo_events` regardless of portal; trade user sees the additional events in §5.3 |
| 5 | Approvals + external approver link | e2e: trade admin approves within limit → deposit invoice drafts (existing flow); trade user sends to owner → owner opens token link, signs → estimate accepted, sender notified, Needs-you card cleared; user over limit is blocked/warned per ⚑; PO / claim references print on the estimate PDF |
| 6 | Money + Team + notifications | Statement PDF and CSV match the ledger to the cent for a seeded org; `finance` user sees money and nothing else; invite flow creates an `account_user` with scope; digest job sends one email per org per day containing only that user's in-scope properties |
| 7 | Three-persona e2e + Tom's 90-second walkthrough | Scripted e2e for real-estate, facilities and insurance orgs covering the 10-second questions in §1; Tom walks the mockup and the build side by side; defects listed and fixed before "workable" |

Definition of done for the module: all seven rows green; colour register diagnostic hypotheses that held are closed by tests, not just by fixes; no client-side money maths; no role-inferred views.

## 8. ⚑ Decisions for Tom (do not invent — build behind a Settings value or a flag where possible)

1. **Approve on behalf of the owner** — allowed for real-estate orgs by default, or must every estimate go to the owner? (Legal: agency authority under the management agreement.)
2. **Approval limits** — enforced (block) or advisory (warn and log)?
3. **Trade payment terms** — 14 days? 30? Per account? (Already flagged as a commercial-launch blocker; now needed for the money screens.)
4. **Touch-up request** — creates a new estimate in `draft` for staff, or a phone-first visit-policy lead (visit-booking brief), or both? Minimum-charge for touch-ups?
5. **PO number** — required to approve for facilities orgs, or optional?
6. **Insurance orgs** — is the assessor the approver, the claims handler, or either? Should the completion report auto-send to the assessor?
7. **Colour card PDF** — Paint Group branded with the property references; include product codes and supplier so the client can buy touch-up paint themselves? (This is the "never look elsewhere" moment — I'd say yes.)
8. **Swatch colours** — do we maintain a hex per catalogue colour in Settings > Products (photo column exists), or accept neutral placeholders until the catalogue is enriched?
9. **Historical backfill** — attempt from Airtable/PaintScout for existing commercial clients' properties, or start from the platform go-live?
10. **`finance` role** — should it see job status (not photos) so accounts can answer "when will this be invoiced"?
11. **Daily digest default** — 5 pm email digest on, or off until the user opts in?
12. **Org kinds at launch** — real estate only, or all three from day one? (Affects session 7 scope and copy.)
13. **Naming** — "Trade portal" internally; what do clients see? "Your Paint Group workspace"? Avoid "trade" in customer-facing copy.
14. **Sharing a timeline** — may a property manager forward a read-only timeline link to a landlord or tenant? (Photo consent scope from the site-capture brief applies.)
