# Claude Code Build Brief — Customer Portal (Phase 3)
**paint-group-platform · August 2026 · sessions 3a-1 → 3a-8**

---

## Kickoff ritual (do this before writing any code)

1. Commit these files, then **confirm the file list back to Tom before writing code**:
   - `docs/briefs/claude-code-brief-customer-portal.md` (this file)
   - `docs/briefs/customer-portal-experience-map.md` (the what and why — v2)
   - `docs/briefs/paint-group-workmanship-warranty.md` (content for the Documents space; DRAFT pending legal review)
   - `design/reference/customer-portal-mockup.html` (approved look and behaviour, phone + desktop, both personas)
2. **Missing reference = STOP and report** (standing CLAUDE.md rule). This brief also depends on files already in the repo/project — read order below. If any is absent, stop and name it; do not improvise.
3. **E2E-first as the real role is law**: every session's verification runs as an anonymous visitor or logged-in customer, never as staff. The wizard failure happened because the customer flow was never run; it does not happen twice.
4. Migrations run **between** gate runs, never during one (standing rule).

## Read order

1. This brief, end to end.
2. `customer-portal-experience-map.md` — the product spec. Section references below (§) point here.
3. `customer-portal-mockup.html` — open it, click every tab, both personas, phone AND desktop toggle. The build must match it: same components phone/desktop (responsive CSS, not two builds), locked design system (Switzer/Martian Mono, ink/cyan palette, amber=awaiting).
4. `customer-identity-link.md` + `audit-response-and-actions.md` — the identity gap this phase closes, and the standing rulings (invoice FK RESTRICT, customer_id NOT NULL deferred behind identity, dedicated test Supabase project).
5. `claude-code-brief-wo-loop-pc-command.md` + `work-order-completion-workflow.md` — wo_events is the source of truth the portal timeline renders.
6. `acceptance-to-paid-workflow.md` + the invoicing phase brief — the money pages render invoicing's output; do not re-model money.
7. Wizard rebuild bundle (`docs/briefs/` one-pager and specs) — the components session 6 embeds; the customer-view contract (`view=customer`, payload by VIEW not role) the portal extends.
8. `paint-group-workmanship-warranty.md` — warranty card + Documents content.

## The flow in one sentence

A customer who saves an estimate silently gains an account; from then on one login shows every property and job they've ever had with us — live photo timeline, money with PDFs, permanent colour register, our credentials, and the wizard ready to price the next job — with commercial accounts getting the same thing aggregated across a portfolio, and all of it fast at tens of thousands of accounts.

## Non-negotiables (from CLAUDE.md and the map, restated)

1. **One estimate tree; lib/pricing prices everything.** The portal never computes money client-side. Money is integer cents, server-side, always.
2. **One account model**: `accounts → properties → jobs` for every customer. Residential vs trade is feature gates on `account_type`, never schema (§3). Commercial = residential + aggregation views + lifted limits.
3. **Role views are strict**: customer/staff/contractor each own rendered views via RLS + explicit `view=` param, never role-inferred. No margins, contractor rates, or other customers' data can reach a customer payload — assert this in tests, not just policies.
4. **The event log renders the portal** (§10.2): timeline, comms, warranty history read wo_events/CRM events through one indexed query pattern. No bespoke per-feature queries.
5. **Volume laws** (§10): pagination + indexes keyed on account/property/job everywhere; RLS backed by those indexes; photos served as CDN thumbnails via signed URLs, never originals; all fan-out (notifications, sequences) queued and idempotent; no unbounded reads (the S5 lesson).
6. **Server boundary**: all mutations via zod-validated server actions / SECURITY DEFINER RPCs per the remediation architecture. No browser→DB writes on money or status.
7. **60-year-old rules** (§7): magic-link default, one primary action per screen, ≥18px body, phone number in the header of every page, plain words, print stylesheets, no dead ends.
8. **Customer-facing copy is English (not Australian) in tone** — warm, plain, unhurried. Reuse the mockup's copy verbatim where it fits.

## Build sessions (copyable, one per Claude Code session)

**3a-1 — Identity model (the foundation; resolves customer-identity-link.md).**
Schema + migrations for `accounts` (account_type residential|trade, limits/flags), `account_users` (join table now, single-user UI for v1 — ⚑6), `properties` (address, attributes, belongs to account), and job/estimate/invoice linkage (`estimates.account_id/property_id`, `invoices.customer refs` per the audit rulings — RESTRICT already ruled; NOT NULL lands after backfill). Wizard save creates account + property + links estimate (email captured early = account seed; drop-outs remain leads). Backfill plan for existing real rows; **first deliverable is a report answering the audit's open question — do historical estimates carry a customer email (linking problem) or was contact detail discarded (data loss)?** Gate: unit + RLS tests prove a customer sees only their own account chain.

**3a-2 — Auth + portal shell.**
Magic-link login (⚑3 default: passwordless; optional password), token-URL estimate links upgrade to sessions, account-created-on-save flow with zero registration screens. App shell per mockup: header with call chip, bottom tabs (phone) / sidebar (desktop), state-aware Home that leads with exactly one primary action derived from the job state machine. E2E: anonymous → wizard → save → land in portal without ever seeing a sign-up form.

**3a-3 — Estimate + Money views.**
Estimate view (existing customer-view contract + presentation blocks) mounted inside the portal with history. Money tab: invoices/receipts across all jobs, status chips, AUD inc GST with GST itemised, PDF downloads, white print stylesheet. Renders invoicing-phase data read-only — if invoicing objects are missing for a state, show honest empty states, never invent. Job status and payment status stay separate.

**3a-4 — Project timeline.**
The vertical feed per job from wo_events: before-photos, per-area progress rollups (customer-level wording: Not started / Being prepped / First coat / Done ✓), PC-approved daily updates, QA entries, milestones, variation cards (approve/decline/ask reuses the mini-estimate flow), who's-on-your-job card (names + photos only). Photos: thumbnail renditions + signed URLs; full-screen tap; before/after pairs where both exist. Match the mockup's timeline exactly.

**3a-5 — Colour register + Documents + warranty card.**
"My colours" per job from the finalised colour schedule (⚑4 default source: schedule at sign-off; structure allows later reconciliation against materials), swatches, PDF download, touch-up CTA. Documents area: Settings → Documents (company docs with expiry dates — public liability cert first ⚑13; expiring cert flags amber in PC console), per-job completion report + colour register PDFs, warranty terms + live warranty card (start = sign-off ⚑ per standing flag; countdown; **render terms with a DRAFT watermark until Tom marks them legally approved in Settings**), "Report an issue" photo-first form → PC console queue.

**3a-6 — Embedded estimate builder + multi-property.**
"Get a new estimate" on Home and per property: mounts the SAME wizard/confirm-loop components as the public site (no fork — assert with a shared-module test), prefilled from the selected property, email-capture step skipped for logged-in users. AI gates by account_type (§3): residential = floorplan 2-session limit with office unblock (⚑12 default: account-wide limit, Settings flag `limits_scope` to flip per-property later); trade = unlimited, full plan-reader. Add-address flow (one screen; both addresses kept; property switcher appears at 2+). E2E: returning customer prices a second job without re-entering known facts.

**3a-7 — Commercial workspace.**
Portfolio Home (count-up tiles, attention queue with one primary action each, jobs-underway list), Properties with per-property paint registers and **one-tap rebook** (prior job tree as wizard starting point), saved specs, drafts, consolidated Money with monthly statement PDF (⚑5: terms display defaults to 14 days, deposit rule unchanged until Tom rules — do NOT invent trade payment terms behaviour). Trade granting is office-side only (⚑2): a flag Tom sets on the account.

**3a-8 — Volume gate + full-loop e2e.**
Seed the dedicated test Supabase project with the volume dataset (order 25k accounts / 60k jobs / 500k photo rows — ⚑14 defaults until Tom adjusts). Measure and report: portal home + timeline p95 (~500ms target), wizard save (<1s), RLS query plans on the hot paths (prove index usage), pagination on every list. Full-loop e2e both personas, phone and desktop viewports: wizard → save → accept → deposit → timeline → variation → sign-off → warranty card → colour register → second estimate. Fix regressions before reporting done.

## ⚑ Decisions — defaults chosen so nothing blocks session 1

All defaults below are Settings-editable and reversible; **do not hard-code any of them**. Where marked BLOCKER, the feature ships behind the default but Tom must rule before the affected audience goes live.

| ⚑ | Decision | Default built | Status |
|---|---|---|---|
| 1 | Floorplan unblock path | Phone + "request unlock" button → PC task | Default OK |
| 2 | Trade granting | Office-set flag only; no self-serve form in v1 | Default OK |
| 3 | Passwordless | Magic-link all accounts; optional password | Default OK |
| 4 | Colour register source | Colour schedule at sign-off | Default OK |
| 5 | Trade payment terms | Display "14-day terms"; deposit behaviour UNCHANGED | **BLOCKER before commercial launch** |
| 6 | Commercial team users | Schema supports many; UI single-user | Default OK |
| 10 | Portal name | "Your Paint Group account" | Cosmetic — Tom anytime |
| 11 | Notification defaults | Email on; SMS milestones-only | Default OK |
| 12 | Limits per account vs property | Account-wide, `limits_scope` setting to flip | Default OK |
| 13 | Documents set | Public liability first; schema takes any doc + expiry | Tom uploads certs |
| 14 | Load targets | 25k/60k/500k seed; p95 500ms; save 1s | Default OK |
| 15 | AI spend alert | $500/month | Default OK |
| — | Warranty terms text | Rendered with DRAFT watermark | **BLOCKER: legal review before watermark removed** |
| — | Warranty start date | Sign-off date (existing standing flag) | Confirm with legal review |
| — | Phone number / deposit % | (03) 9000 0000 and 30% are MOCKUP PLACEHOLDERS | Tom supplies real values in Settings |

⚑7 (portfolio reporting) and ⚑8/9 (retargeting cadence/thresholds) are explicitly OUT of phase 3 — phases 4–5.

## Definition of done

- Every acceptance outcome in experience map §14 passes, demonstrated in e2e as the customer role, on phone and desktop viewports.
- The volume gate (3a-8) report is written with measured numbers against the seeded dataset.
- No new browser→DB mutations; all money paths server-side in cents; RLS tests prove account isolation both ways (customer can't read out, staff views unaffected).
- Wizard components are provably shared between public site and portal (one import path).
- customer-identity-link.md is closed with a written resolution note, and the NOT NULL migration from the audit ruling lands once backfill is verified.
- Tom's 90-second walkthrough: from a text message link, on his phone, he can see photos of a live job, download an invoice PDF, check his colours, and start a new estimate — without instructions from anyone.
