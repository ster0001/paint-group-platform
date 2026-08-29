# Build brief — CRM & Customer Growth
### Revision 2 · supersedes revision 1 entirely

**Module:** CRM (buildout step 4) + follow-ups/remarketing (step 5), now spanning four sub-modules
**Repo:** `paint-group-platform` · Next.js 16 App Router + TS + Tailwind + Supabase
**Status:** DRAFT. This is the master plan. Three sub-briefs hold the detail.

**What changed in revision 2**
- **Site Capture added as a prerequisite.** Photos, voice notes and consent are captured at the job. The Google Photos idea is dropped
- §6 (campaigns) removed from this document and replaced by the campaign studio brief
- Referrals added as a fifth workstream, with the sending model ruled
- The call-to-action and callback loop added, closing the circle from campaign back into the pipeline
- One consolidated session plan (§6) and one decision register (§7) across all four briefs

---

## 0. The document set

This brief is the map. The detail lives in three others. **Do not build from this document alone** — each session names its source brief.

| Brief | Covers |
|---|---|
| `claude-code-brief-crm-retargeting.md` | **this file** — pipeline, events, stages, segments, attribution, and the sequencing across all four |
| `claude-code-brief-site-capture.md` | photo and voice capture on site, storage, offline queue, marketing consent |
| `claude-code-brief-campaign-studio-referrals.md` (rev 2) | AI campaign writing, photo emails, media sources, CTA links, refer-and-reward |
| `claude-code-brief-full-audit.md` | the audit and hardening programme running alongside |

**Also required — `docs/briefs/`:** `claude-code-brief-customer-portal.md` · `customer-identity-link.md` · `claude-code-brief-invoicing-payments.md` · `claude-code-brief-wo-loop-pc-command.md` · `post-wizard-buildout-order.md` · `CLAUDE.md`

**Design reference — `design/reference/`:** `pc-command-mockup.html` · `invoicing-dashboard-mockup.html` · `crm-board-mockup.html` (built) · `site-capture-mockup.html` (to build) · `campaign-studio-mockup.html` (to build) · `referral-hub-mockup.html` (to build)

**STOP-and-report applies throughout.**

---

## 1. What this module is now

Five workstreams, one customer record:

1. **The spine** — every event, one append-only log, one timeline per customer
2. **The pipeline** — stage derived from facts, temperature and snooze set by staff, a board that moves itself
3. **The lists** — one segment evaluator, shared by every surface
4. **The outbound** — campaigns written with AI, illustrated with your own job photographs, approved by a human, sent under guard
5. **The inbound loop** — call-to-action links, callback requests into the attention queue, and referrals where the customer does the introducing

Site Capture sits underneath all of it, because four of the five depend on photographs being attached to jobs with consent recorded.

**The unchanged rules from revision 1, all still binding:**

- **No second customer database.** One identity model — `accounts` / `account_users` / `properties`. If a session proposes a `crm_customers` table, stop and report.
- **One event log.** `crm_events`, append-only, never updated, never deleted.
- **Stage is derived, never stored.** One pure function. No status column, no drag-to-stage.
- **One segment evaluator.** Board, preview, campaign sweep and attention queue all call it.
- **Sending is guarded, idempotent, and off by default.** Unique send key, eight-step guard chain, auto-send ships OFF.

---

## 2. The spine (unchanged from revision 1, with additions)

`crm_events` as specified in revision 1 — `account_id`, optional property/estimate/work-order refs, `occurred_at` separate from `recorded_at`, typed `payload`, `dedupe_key` for idempotency, source of `system | staff | customer | ai`.

**Event types added in revision 2:**

| New type | Written by |
|---|---|
| `site_photos_captured` | Site Capture, on upload completion — count and stage |
| `photo_consent_recorded` | walkthrough sign-off — scope and wording version |
| `photo_consent_withdrawn` | portal or staff action |
| `cta_clicked` | campaign link click |
| `callback_requested` | landing page submission |
| `offer_granted` / `offer_expired` / `offer_applied` | the offer entitlement lifecycle |
| `referral_link_shared` | customer taps share in the portal |
| `referral_landed` | a referred person arrives |
| `referral_converted` | referred job reaches the reward trigger |
| `reward_chosen` / `reward_redeemed` / `reward_clawed_back` | reward ledger |

Everything else from revision 1's type list stands.

---

## 3. Pipeline and stages (unchanged)

Stage derived from facts by `lib/crm/stage.ts`; temperature and `snooze_until` stored separately as staff judgement. Fourteen stages from `lead_incomplete` through `past_customer` and `lost`. Board lanes match, cards carry name, suburb, value, days-in-stage, temperature and next touch. **No drag-to-change-stage.** Pure function, unit-tested against ~30 account shapes.

Full specification in revision 1 §4, which stands unaltered. `crm-board-mockup.html` shows the built form.

**One addition:** a `cta_clicked` event nudges temperature. A click on a spring campaign from a two-year-old customer is the strongest signal you will get from that list, and it should be visible on the board the same day.

---

## 4. Segments (unchanged, plus one standing list)

`lib/crm/segments.ts` — one evaluator, criteria as a form not a query language, relative dates only, live count and 20-name sample before save. Full field list in revision 1 §5.

**New standing segment, worth building as a system segment:**

> **Interior customers with no exterior job** — people whose inside you painted and whose outside you have never quoted.

They already trust you and have a surface you've never priced. Higher intent than any cold exterior list, and the copy writes itself. This came out of the campaign example in the studio brief and is probably the best list you own.

---

## 5. Attribution (unchanged)

First-touch and last-touch capture on the wizard and every landing page; `lib/crm/attribution.ts` resolving raw params to a taxonomy; a "how did you hear about us?" question for the non-digital sources; staff override recorded as an event with a reason; reporting from the new website's launch date forward with earlier data labelled partial. Revision 1 §8 stands.

**Addition:** referral arrivals resolve to `referral_customer` with the referring account attached, so the source report shows referral revenue and the referrer's record shows what they generated.

---

## 6. Consolidated session plan

Sessions are grouped into four phases. Each names its source brief. Every session ends with typecheck and lint clean, unit tests green, and an e2e run in the real role. Migrations run between gate runs.

### Phase 0 — Unblock (must complete before anything else)

| # | Session | Brief | Why first |
|---|---|---|---|
| **0.1** | Portal identity model (`accounts`/`account_users`/`properties`) | portal | **Hard blocker on everything.** `customer-identity-link.md` is open; 70 of 71 estimates have no customer |
| **0.2** | Dedicated test Supabase project + test-data cleanup | audit | Every count, segment and report is fiction until this lands |
| **0.3** | Tenancy ruling and, if ruled in, tenant column + tenant-aware RLS | audit | Every table built after this without it makes the retrofit larger |

Phase 0 is not optional and not parallelisable with the rest. Building the CRM before 0.1 produces a second customer table.

### Phase 1 — Site Capture

Source: `claude-code-brief-site-capture.md`. Sessions 0–10 as specified there.

| # | Session | Depends on |
|---|---|---|
| 1.0 | Rulings, reference commit, `site-capture-mockup.html` | S1, S4 |
| 1.1 | Schema + storage adapter | 0.1 |
| 1.2 | Upload pipeline — resize, compress, EXIF strip, hash, resumable | 1.1 |
| 1.3 | Offline queue | 1.2 |
| 1.4 | Capture UI — PWA camera, room chips, surface tags | 1.3 |
| 1.5 | Voice notes + transcription | 1.4, S6 |
| 1.6 | Estimate integration — photos by room, hero, missing-room prompt | 1.4 |
| 1.7 | Customer-facing photos on the estimate | 1.6 |
| 1.8 | **Consent capture at sign-off** | walkthrough sign-off, S4 |
| 1.9 | Media library API — the consent-scoped read | 1.8 |

Sessions 1.1–1.4 deliver value alone: photos land on jobs. **1.8 can be pulled forward** if the campaign timeline tightens — consent debt grows every day it waits.

### Phase 2 — CRM core

Source: this brief and revision 1 §§3–5, 8.

| # | Session | Depends on |
|---|---|---|
| 2.1 | Event spine — `crm_events`, zod payloads, RPC write path, backfill (test project only) | 0.1, 0.2 |
| 2.2 | Timeline + activity logging — four chips, note, snooze, temperature | 2.1 |
| 2.3 | Stage function + board + lead inbox | 2.2, C1–C5 |
| 2.4 | Attribution capture | 2.1, C13–C14 |
| 2.5 | Segments — evaluator, builder, live preview, standing segments | 2.3, C6 |

### Phase 3 — Campaign studio

Source: `claude-code-brief-campaign-studio-referrals.md` rev 2.

| # | Session | Depends on |
|---|---|---|
| 3.0 | `campaign-studio-mockup.html` | M15 |
| 3.1 | Campaign engine, draft-only — enrolments, sweep, guard chain, approval queue. Plain text | 2.5 |
| 3.2 | Email block system — seven blocks, six-client render suite | 3.1 |
| 3.3 | Media library + consent-scoped picker | 1.9, 3.2 |
| 3.4 | Google Drive — Picker, `drive.file` scope, copy-on-select | 3.3, M15 |
| 3.5 | Studio UI — slot filling, curation, layout, colour accent, preview | 3.3, 3.4 |
| 3.6 | AI generation — one prompt, photo slots, claim validator, offer checker, segment-copy match | 3.1, 3.5, M5, M14 |
| 3.7 | CTA + callback — signed links, landing page, attention queue, offer entitlements | 3.1, M17 |
| 3.8 | Sending — provider, consent, unsubscribe, delivery events, quiet hours | 3.1, C9, C17 |
| 3.9 | Lifecycle campaigns — post-job care, warranty 1 and 2, repaint cycles, reactivation | 3.8, C7, C12 |

### Phase 4 — Referrals

Source: campaign studio brief rev 2, Part D.

| # | Session | Depends on |
|---|---|---|
| 4.0 | `referral-hub-mockup.html` | M1 |
| 4.1 | Referral core — links, share-sheet flow, attribution into the wizard, milestone notifications, portal hub | 3.8, M1–M4, M7, M8 |
| 4.2 | Rewards — menu, ledger, redemption against future work, clawback, anti-gaming | 4.1, M2, M8 |
| 4.3 | Business referrers — partner accounts, dashboard, bulk introduction, commission | 4.2, M10 |

### Phase 5 — Deferred and optional

| # | Session | Depends on |
|---|---|---|
| 5.1 | Google Photos — Picker API session flow, polling, copy-on-select | 3.4, M16 |
| 5.2 | Source reporting dashboard | 2.4 + new website launch |
| 5.3 | Full gate — e2e per role, 25k-account volume test, six-client render suite, anti-gaming adversarial suite | everything |

5.1 is deliberately last. It is the least certain integration and the clunkiest flow, and nothing waits on it.

---

## 7. Consolidated decision register

Original IDs preserved so the sub-briefs stay readable. **Blockers first.**

### Ship blockers

| ID | Brief | Decision |
|---|---|---|
| **A3** | audit | **Tenancy** — no, later-but-cheap-insurance, or full multi-tenant. Blocks the audit's scope and every schema built after it. The Sydney partner-painter model may already have decided this |
| **A4** | audit | Dedicated test Supabase project — approve now |
| **S1** | capture | Storage provider — Supabase behind an adapter, or R2 straight away. *Recommend Supabase + adapter* |
| **S4** | capture | Consent wording, all three scopes, versioned. Worth a legal read |
| **M1** | studio | Reward economics — set against cost per acquired job from paid ads, not by feel |
| **M15** | studio | Which Google account connects — a Paint Group business account on a shared drive, not a personal one |
| **C9** | CRM | Consent model for marketing — registration wording, and whether past customers count as inferred consent under the Spam Act. **Needs legal.** Blocks auto-send |
| **C17** | CRM | Email + SMS provider, settled together with the inbound-parsing requirement from cost capture |

### Ruled

| ID | Ruling |
|---|---|
| **M9** | Referrer sends the introduction themselves. **No send-to-a-friend form is to be built**, not behind a flag |
| — | Google Photos is not the estimating photo store. Site Capture replaces it |

### Phase 1 — Site Capture

| ID | Decision |
|---|---|
| S2 | Photo retention period |
| S3 | Resolution and quality target (2400px long edge proposed) |
| S5 | Retrospective consent for the existing photo library — ask, or start clean from launch |
| S6 | Transcription provider and monthly ceiling |
| S7 | Purge schedule for soft-deleted photos |
| S8 | Who can capture — estimators only, or contractors too |
| S9 | AI-suggested estimate lines from voice notes in v1, or transcript-only |
| S10 | Do customers see site photos in the portal, or only estimate-attached ones |
| S11 | Native app ever, or PWA permanently |
| S12 | Interim arrangement before session 1.4 — stopgap or wait |

### Phase 2 — CRM core

| ID | Decision |
|---|---|
| C1 | Stage list final |
| C2 | Days-in-stage thresholds that turn a card amber |
| C3 | Who sets temperature, and does it expire |
| C4 | What counts as `negotiating` — automatic on a revised estimate, or staff-flagged |
| C5 | `past_customer` threshold |
| C6 | Basket size bands |
| C13 | Lead source taxonomy final |
| C14 | Attribution model — first-touch, last-touch, or both side by side |
| C18 | AI agent sequencing — before the CRM, per the 27 Aug proposal |

### Phase 3 — Campaigns

| ID | Decision |
|---|---|
| C7 | Repaint cycle intervals, interior and exterior |
| C8 | Do trade and commercial accounts get separate sequences, or none |
| C10 | Frequency cap |
| C11 | Quiet hours and permitted days |
| C12 | Lifecycle campaign list and priority order |
| C15 | Wizard drop-outs — immediate, grace period, or only after staff contact |
| C16 | Offers in remarketing — policy on discounts and incentives |
| M5 | Which AI entry points ship in v1 |
| M6 | Retrospective photo consent (duplicate of S5 — rule once) |
| M14 | AI monthly spend ceiling |
| M16 | Google Photos — build it at all |
| M17 | Callback SLA before a request goes amber |
| M18 | Build the interior-no-exterior cross-sell segment as a standing one |

### Phase 4 — Referrals

| ID | Decision |
|---|---|
| M2 | Which rewards are on the menu |
| M3 | Friend's side — fixed amount or percentage |
| M4 | Cap per customer per year |
| M7 | "Already a known contact" window for eligibility |
| M8 | Reward trigger — deposit paid, job started, or completed |
| M10 | Business referrer programme — v1 or later; structure, agreement, accounting |
| M11 | Neighbour offer for exterior jobs |
| M12 | Colour-thread idea |
| M13 | Terms and conditions — who writes, where published |

---

## 8. Dependency map

```
0.1 portal identity ──┬─→ 1.1 capture schema ──→ 1.2 → 1.3 → 1.4 ──→ 1.6 → 1.7
                      │                                        └─→ 1.5 voice
                      │        walkthrough sign-off ──→ 1.8 consent ──→ 1.9 library API
                      │                                                      │
                      └─→ 2.1 events ─→ 2.2 timeline ─→ 2.3 board ─→ 2.5 segments
                                     └─→ 2.4 attribution                     │
                                                                             ▼
                                              3.1 engine ─→ 3.2 blocks ─→ 3.3 media ─→ 3.4 Drive
                                                    │                            └─→ 3.5 studio
                                                    ├─→ 3.7 CTA + callback              │
                                                    └─→ 3.8 sending ←─────── 3.6 AI ────┘
                                                              │
                                                              └─→ 3.9 lifecycle
                                                              └─→ 4.1 referrals ─→ 4.2 rewards ─→ 4.3 partners

0.2 test project ─→ (precondition for every measurement, backfill and volume gate)
0.3 tenancy ──────→ (precondition for every table created after it)
```

**Critical path:** 0.1 → 2.1 → 2.2 → 2.3 → 2.5 → 3.1 → 3.8 → 4.1. Everything else can slip without stopping the rest.

**Longest lead item:** photo consent (1.8). It depends on sign-off, gates the marketing library, and accumulates debt daily.

---

## 9. Acceptance gates

Each phase has its own criteria in its own brief. These are the cross-cutting ones that no phase owns and everyone can therefore forget.

- [ ] **One identity model.** No sub-module has created a customer table. Verified by schema review, not by grep alone.
- [ ] **One implementation each** of pricing, ledger, attention, stage, segments, attribution, money formatting and date handling. Grep-verified in CI.
- [ ] **`crm_events` is append-only.** No UPDATE or DELETE grant on any role; an attempted update in a test fails.
- [ ] **Browser→DB mutations across all four modules: 0.**
- [ ] **Photo consent is honoured end to end.** A job marked internal-only at sign-off is absent from the campaign picker, and withdrawal propagates to live campaigns within one request cycle.
- [ ] **No message reaches anyone who has not contacted Paint Group.** No send-to-a-friend form exists in the codebase. Reviewer-verified.
- [ ] **The guard chain holds.** A customer who accepts between enrolment and send receives nothing. Explicit test.
- [ ] **Idempotency.** Running every sweep twice produces zero duplicates — messages, enrolments, photo rows, rewards.
- [ ] **Volume.** 25,000 accounts, 100,000 events, 25,000 photos: board under 1.5s, segment preview under 3s, estimate photo view under 2s on 4G. No unbounded query anywhere.
- [ ] **Offers survive the journey.** An offer made in an email appears on the estimate raised from it and expires on its stated date.
- [ ] **Production holds real data only.** Test artefacts removed; all e2e against the test project.

---

## 10. Risks, in the order they'll bite

1. **Phase 0 gets skipped because it produces nothing visible.** Identity, test project and tenancy are three sessions of invisible work that determine whether the next thirty are sound. Every one of them gets more expensive with each module shipped over the top.
2. **Consent debt.** Jobs completed before 1.8 have no marketing consent, and asking retrospectively gets harder over time. Rule S5 early even if you build 1.8 late.
3. **Adoption of Site Capture is a product risk, not a code risk.** If the camera is slow or tagging takes more than a tap, estimators use the phone's own camera and the whole media chain has nothing to read. Judge the mockup on a phone, outdoors.
4. **AI marketing copy has a long tail.** One invented warranty term in one email to 63 people outweighs a hundred bland ones. The claim validator and the approval queue are not early-optimisation targets.
5. **Referral schemes fail quietly.** They don't break, they just go unused. Instrument asks-shown, links-copied, links-opened, referrals-landed, converted — each poor ratio has a different fix.
6. **Scope.** Five workstreams. Sequencing them so that each phase ships something usable — photos on jobs, then a working board, then a plain-text campaign engine — means a slip anywhere still leaves you with more than you have today.
