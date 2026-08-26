# Customer Portal — End-to-End Experience Map
**Features & benefits, v2 — for Tom's review before any build brief is written**
Paint Group platform · August 2026

*v2 (26 Aug) adds Tom's four rulings: residential accounts hold multiple properties and jobs without becoming commercial (§3); the estimate builder is embedded in the portal with AI gated by account type (§4-B4); a Documents space for insurances and warranty (§5); and a Built for Volume section for thousands of new portals a year (§10).*

---

## 1. What we're building

One logged-in home for every Paint Group customer, from the moment they save their first estimate to years after the last coat dries. For a homeowner it's "my painting project, all in one place." For a real estate agency, builder or body corporate it's "the paint record and job pipeline for every property we manage" — infrastructure they'd have to walk away from to use anyone else.

The portal is **phase 3 in the post-wizard buildout order** and deliberately sits after the WO completion loop (phase 1) and invoicing (phase 2), because those two phases *generate the content* the portal displays. Almost nothing below requires new data — the portal is a customer-facing window onto machinery that already exists or is already specced: WO ticks and photos, the colour schedule, invoices, the estimate tree, wo_events.

### The eight experience bars (your brief), translated into design rules

| Your bar | Design rule it becomes |
|---|---|
| Out-of-this-world experience | The portal *shows the job happening* — live photos, progress, named people — not a static account page. Same locked design system (Switzer/Martian Mono, ink/cyan) as the estimate, so it feels like one product, not a bolted-on login. |
| Easy for a 60-year-old | No passwords by default (magic link), one primary action per screen, big type, plain words, phone number visible on every page. Full rules in §7. |
| Commercial clients never look elsewhere | Their operational data lives here: per-property paint registers, one-tap repeat jobs, consolidated billing. Switching painters means losing the register. §6. |
| Builds trust | Trust is engineered per stage — evidence, not claims. Photos before promises, named humans, money always itemised with GST. §8. |
| Seamless quote → platform | The account already exists (created on first estimate save — decided). The estimate link IS the front door; "log in" is never a separate chore. §4-A. |
| Retargeting the gap | State-machine sequences on estimate status, built on the CRM phase, high-volume-ready from day one. §9. |
| Always clear they can speak with us | "Speak to a person" is a permanent element, never buried. Every automated message and AI reply carries a human escape hatch. §5-C. |
| Photos in one timeline | The Project Timeline — auto-built from contractor ticks, daily updates and QA checks. Zero extra work for anyone. §4-D. |

---

## 2. The journey at a glance

Ten stages. The portal is **state-aware**: it knows which stage each customer is in and leads with exactly one primary action for that stage — a 60-year-old never has to work out what to do next.

| # | Stage | What the customer sees when they log in | What it does for Paint Group |
|---|---|---|---|
| 1 | Builds an estimate (wizard) | The wizard itself; email captured early | Every drop-out is a lead (decided) |
| 2 | Saves the estimate | Account is born silently; estimate lands in "My estimates" | Warm CRM lead, zero friction |
| 3 | **The gap** (thinking it over) | Their estimate, an "Any questions?" card, AI helper, book-a-call | Retargeting sequences run (§9) |
| 4 | Accepts & pays deposit | Accept → deposit invoice → paid receipt, all in one flow | Acceptance auto-creates invoice (decided) |
| 5 | Getting ready | Colour consult status, booking confirmation, pre-start checklist visible | Colours chased through the portal, not phone tag |
| 6 | Job underway | **Project Timeline**: photos, per-area progress, daily updates, who's on site | Fewer "how's it going?" calls; updates are PC-approved (decided) |
| 7 | Variations (if any) | Mini-estimate to approve with photos and price, one tap | Reuses the decided two-sided variation flow |
| 8 | Walkthrough & sign-off | Per-area approve/flag, type-to-sign, then the completion report | Sign-off = master event (decided): final invoice, warranty start, review ask |
| 9 | Aftercare | **Your Colours** register, warranty card, invoice archive, completion report | The 6-months-later login; feeds the 2-yr warranty anniversary sequence |
| 10 | Comes back / refers | "Start a new estimate" pre-filled with their property; review & referral prompts | Repeat work and reviews at near-zero acquisition cost |

---

## 3. One account model, two experiences

**Core rule (Tom's ruling, 26 Aug): every account — residential or commercial — owns properties, and properties own jobs.** A homeowner who moves house adds the new address to the same account; a homeowner who builds an extension books a second job against the same property. Neither makes them "commercial", and nothing is lost: the old home's colour register, photos, invoices and warranty card stay in the account for good, right beside the new home's. This is also the retention story for movers — the customer who loved you in Northcote brings their account to Preston, and the wizard prefills from what the account already knows.

The difference between residential and trade is therefore **feature gates and defaults, never schema**:

| | Residential | Commercial (trade) |
|---|---|---|
| Properties per account | Unlimited (typically 1–2) | Unlimited (portfolios) |
| Jobs | Any number, usually one at a time | Many simultaneous, pipeline view |
| Wizard estimates | Rate-limited (2/email — decided) ⚑12 | Unlimited (decided) |
| AI features (floorplan plan-reader, AI chat) | **Limited** — floorplan blocked after 2 sessions, office unblock ⚑1 | **Fully enabled** |
| Home screen | The story of the current job (property switcher appears once a second address exists) | Portfolio aggregates across properties |
| Billing | Per job | Consolidated + statements |

**Residential** — the portal reads like a story: *your* estimate, *your* project, *your* colours. With one property it never mentions the properties layer at all; the moment a second address is added, a simple switcher appears ("12 Acacia Street · 4 Elm Grove") and everything else stays identical. Adding an address is one screen: address, and whether it replaces the old home or sits alongside it (both are kept either way).

**Commercial (trade)** — real estate agencies, builders, body corporate. Same shell, same schema, plus the aggregation layer: portfolio dashboard, unlimited wizard runs with full AI, consolidated billing. Full treatment in §6. Trade access is granted, not self-served (⚑2) — the moment of granting it is itself a sales touchpoint ("we've set you up with a trade account").

Why this matters for the build: **commercial is residential plus aggregation views and lifted limits** — one schema, one component set, one RLS model keyed on account → property → job. It follows the platform's existing strict role-view rule (explicit view param + RLS, never role-inferred), and it is the definitive answer to the open customer-identity question from the audit (customer-identity-link.md): the `accounts / properties / jobs` chain IS the customer identity layer, and estimates and invoices link into it.

---

## 4. Feature map by journey stage

Each feature: how it works → what the customer gets → what Paint Group gets.

### A. From quote to account — the seamless transition

**A1. The account that already exists.**
Saving the first estimate creates the account (decided). No sign-up form, no "create a password" wall. The confirmation screen simply says: *"Your estimate is saved. We've sent a link to your email — use it any time to come back to your project."*
→ *Customer:* nothing to do, nothing to remember. → *Paint Group:* zero drop-off at the registration step, and every save is a CRM contact with consent captured (per AU law, decided).

**A2. Magic-link login (passwordless by default).** ⚑3
Every email/SMS the platform sends carries a personal link straight into the portal — the same token-URL pattern already decided for the estimate view, upgraded to a full session. "Log in" on the website = enter your email → tap the link we send. Password optional for those who want one; commercial users likely need passwords/SSO-style hygiene (⚑3).
→ *Customer:* the single biggest usability win for older users — nobody's locked out of their own project. → *Paint Group:* no password-reset support burden; every link is also an engagement tracker (view tracking already decided).

**A3. State-aware home screen.**
One screen, one headline, one primary button, driven by the job state machine that already exists (estimate statuses + WO stages). Examples: *"Your estimate is ready — $8,450 inc GST"* [View my estimate] · *"Marco starts Tuesday 8am"* [See what happens next] · *"Painting day 3 of 6 — 2 new photos today"* [See today's progress].
→ *Customer:* never lost, never hunting through menus. → *Paint Group:* the primary button is always the next step in *your* pipeline — the UI itself moves jobs forward.

### B. Deciding — estimate, AI helper, and the human path

**B1. The living estimate.**
The estimate view already decided (dark online, white print, accept/decline/ask, presentation blocks with video, before/afters, reviews, liability cert + SWMS) — now living inside the portal so returning customers land on it with history intact. Price ranges shown per the accuracy rules (±4/±8/±15) until staff review fixes them.

**B2. AI estimate helper.**
A chat panel scoped to *their* estimate: explains any line in plain language ("What's a mist coat?", "Why is the hallway such a big part of the price?"), adjusts wizard answers by conversation ("Actually the lounge is more like 5×4" → translator into wizard state, per the phase-2 chat design), and **never computes price** — it drives the same tree that lib/pricing prices. Hard escalation stops per the agent guide; every AI answer ends with *"or call us on [number] — happy to talk it through."*
→ *Customer:* instant answers at 9pm without feeling silly asking. → *Paint Group:* pre-qualification continues out of hours; escalations arrive as warm, context-rich handoffs. *Note: chat is already deferred to phase 2 — the portal ships with B3 as the day-one answer path, chat slots in later without redesign.*

**B3. "Speak to a person" — the permanent element.**
Phone number in the portal header on every page (the website's older-visitor rule, applied here). Plus a one-tap **"Request a call back"** card that creates a task in the PC console with the customer's context attached — estimate open on screen, stage, history.
→ *Customer:* bar #7 satisfied literally everywhere. → *Paint Group:* callbacks arrive with full context; no "who is this and what did they want?"

**B4. The estimate builder lives in the portal (Tom's ruling, 26 Aug).**
The wizard and confirm-loop editors are embedded in the portal as **the same components the public website uses** — one codebase, one estimate tree, lib/pricing prices everything, per the standing one-tree rule. "Get a new estimate" appears on Home and on every property: it opens the wizard prefilled with the chosen property (address, storeys, and — for a property with history — known rooms and prior scope as starting points). AI capability follows the account type gates in §3: residential runs with the limited tier (floorplan attach for 2 sessions, then the friendly office-unblock path; AI chat per the phase-2 rollout), commercial runs with everything on — unlimited sessions, full plan-reader. A logged-in start skips the email-capture step entirely (the account is the identity), so a returning customer is 30 seconds closer to a price than a stranger is.
→ *Customer:* their next estimate starts where their history already lives — no re-typing the house they already described. → *Paint Group:* repeat work self-serves; the public wizard and the portal wizard can never drift apart because they are the same code.

### C. Acceptance, money, and getting ready

**C1. Accept → deposit → receipt in one flow.**
Accepting triggers the deposit invoice (decided: deposit on accept, final on sign-off). Pay by card/bank link (Stripe — provider + surcharge already ⚑ in phase 2), instant receipt, and the home screen flips to *"You're booked. Here's what happens next"* with a plain 4-step graphic (echoing the website's plain 4-step section).
→ *Customer:* pays in 60 seconds, immediately shown what they've bought. → *Paint Group:* cash on acceptance, and the chase ladder (decided) handles the rest without anyone drafting emails.

**C2. Invoices & payments, forever.**
A money page listing every invoice and payment across all their jobs: status chips (paid / due / overdue in the existing emerald/amber/clay language), amounts always **AUD inc GST with GST itemised**, one-tap **Download PDF** for every invoice and receipt, full payment history. Job status and payment status stay separated (decided).
→ *Customer:* tax time and warranty claims are self-service. → *Paint Group:* "can you resend that invoice?" disappears; commercial accounts get statements (§6).

**C3. Pre-start visibility — especially colours.**
The pre-start checklist state surfaces to the customer, led by colours (decided: colour schedule is the first pre-start item, amber "Colours: TBC — consult booked" until done). The portal shows a **colour consult card**: book/reschedule the consult, see chosen colours appear as they're confirmed, with swatches.
→ *Customer:* the fun part of the project (colours!) happens in the portal — the emotional hook that gets them into the login habit before the job even starts. → *Paint Group:* colours confirmed earlier; the named-blocker amber in the PC console gets a customer-side nudge for free.

### D. Job underway — the Project Timeline (bar #8)

**D1. The timeline itself.**
A single vertical, phone-first feed per job, newest at top, built **entirely from data the WO loop already captures**: before-photos (mandatory before first tick — decided), per-surface progress rolled up to friendly area level ("Front of house: prepped ✓, first coat today"), PC-approved daily updates (already drafted from ticks — decided), QA check entries with photos, variation events, milestone cards (deposit paid, job started, walkthrough booked, signed off). Every photo full-screen tappable; before/after pairs auto-composed where both exist.
→ *Customer:* watches their own home transform from their phone at work — this is the "out of this world" moment, and it's shareable ("look what they did today"). → *Paint Group:* zero additional effort (contractors already photo-log), dramatic drop in progress calls, and every daily update is brand marketing delivered to the person mid-purchase.

**D2. Who's on your job.**
A small persistent card: contractor first name + photo, PC name, and the schedule ("Day 3 of 6"). Nothing more — no contractor rates or margins ever cross the role boundary (existing strict view rule).
→ *Customer:* strangers in the house become named, accountable people. → *Paint Group:* the brand promise ("contractors represent the brand") made visible.

**D3. Variations, customer side.**
The decided two-sided variation flow already gives the customer a mini-estimate to approve — the portal is simply where it lives: photo evidence, plain description, price inc GST, approve/decline/ask buttons, and the decision recorded on the timeline and completion report.
→ *Customer:* no surprise extras, ever — everything priced and approved in writing before work proceeds. → *Paint Group:* the single biggest trust-killer in this industry (surprise charges) is structurally impossible.

### E. Walkthrough, sign-off, and the completion report

Per-area approve/flag with rectification loop and type-to-sign (all decided) runs *in the portal* — same place they've watched the job happen, so sign-off feels like the natural last scene, not paperwork. Remote deemed sign-off (72h + nudge ladder, framed as payment-due — decided, pending legal review) runs off portal view-tracking.

Sign-off flips the job to its **permanent record**: the auto-generated completion report (falls out of the WO loop free — decided), the full photo timeline preserved, warranty card issued, final invoice presented, and the review request (decided) made at the exact peak-happiness moment — with the freshly generated before/after pairs one tap from Google Reviews.

### F. Aftercare — the 6-months-later login (your consideration #4)

**F1. "Your Colours" — the permanent paint register.**
For every completed job, a register generated from the finalised colour schedule + the materials records: per room/elevation — brand, product line, colour name & code, sheen/finish, where used, date applied. Presented with rendered swatches, printable, downloadable as PDF. One button: **"Need touch-up paint or a repaint? "** → pre-filled enquiry. (⚑4: source of truth — finalised colour schedule vs materials actually ordered vs both reconciled.)
→ *Customer:* the exact thing consideration #4 asks for — log in 6 months (or 6 years) later and know precisely what's on every wall. Nobody else in the market offers this. → *Paint Group:* a **permanent retention tether**. The register only lives here; it's the anniversary-sequence hook ("your Hamptons White is 2 years old — warranty check?") and the reason a future repaint enquiry comes to you pre-specced.

**F2. Warranty card.**
The 2-year workmanship warranty as a live card: start date (= sign-off, decided, ⚑ pending), what's covered in plain language, and a **"Report an issue"** button that opens a photo-first form routed to the PC console.
→ *Customer:* warranty is a living promise, not a PDF paragraph. → *Paint Group:* warranty claims arrive structured with photos; the anniversary calendar (decided, phase 5) has a destination to point at.

**F3. Everything, forever.**
Estimates, invoices, receipts, completion reports, colour registers, photo timelines — for every job they've ever run, permanently. The archive is the moat: leaving Paint Group means leaving your property's history.

---

## 5. Cross-cutting features

**Communications hub (your consideration #6).** One "Messages & activity" view per customer threading everything: emails sent by the platform (estimate sent/viewed, invoices, updates), AI chat transcripts, callback requests, daily updates, variation approvals — each stamped and linked to its job. Send via email/SMS/WhatsApp with view tracking is already decided; the hub is the customer-side mirror of the same event log (wo_events + CRM events), so it's a rendering job, not new infrastructure.
→ *Customer:* "where did they say that?" has one answer. → *Paint Group:* disputes die quickly when both sides see the same timeline; staff see the identical thread in the PC console.

**Documents & credentials (Tom's ruling, 26 Aug).** A "Documents" area on every account holding, always current and always downloadable: our insurance certificates (the $20M public liability certificate of currency, plus workers' compensation and any others ⚑13), the warranty terms and each job's warranty card, SWMS where relevant, and each job's completion report and colour register PDF. Company-level documents (the insurance certs) are uploaded once in Settings → Documents with an expiry date; every portal shows the current version automatically, and a certificate nearing expiry flags amber in the PC console so a lapsed cert can never be on display ⚑13. This extends the decided presentation attachments (liability cert + SWMS on estimates) into a permanent home.
→ *Customer:* proof of cover on hand whenever their building manager, strata committee or insurer asks. → *Paint Group:* for agencies and body corporate this is compliance self-service — no more emailing the certificate every time a new property manager asks — and it is one more thing living in the portal that a competitor's quote doesn't come with.

**Notifications that respect people.** Default: email + SMS for the moments that matter (estimate ready, booking confirmed, job started, new photos, invoice, sign-off request). One-tap frequency control ("every update" / "milestones only"). Quiet hours. Every message deep-links (magic link) to the exact card it's about.

**Print-friendly everything.** Estimate already has a white print stylesheet (decided) — extend the pattern to invoices, colour register, completion report. Older customers print things; commercial customers file things.

---

## 6. The commercial workspace (your considerations #1 and the "never look elsewhere" bar)

Everything in §4–5, plus a layer designed around one insight: **a property manager's real problem isn't finding a painter — it's the admin around 40 painters' jobs a year.** Solve the admin and the painting follows.

**W1. Portfolio dashboard.** Every property, every job, one screen: address, stage chip, next action, amount. Filter by property, stage, month. This is the PC console's pipeline view, re-cut for a client's own jobs.
→ *Their benefit:* the state of every repaint across the rent-roll without a single phone call. → *Yours:* the client's mental model of "our painting" lives inside your product.

**W2. Unlimited wizard, built for speed and delegation.** Trade accounts already bypass the 2-estimate limit (decided) and the floorplan block never applies. Add: property address book (saved properties with their details pre-filled), and **saved specs** — "3-bed unit, end-of-lease repaint, Level 3 finish, whole interior" as a reusable template.
→ *Their benefit:* an end-of-lease repaint quoted in under 2 minutes from their desk, at 4:55pm on a Friday. → *Yours:* commercial volume flows in with zero estimator time — exactly the self-built pre-qualification the whole platform exists for.

**W3. One-tap rebook.** Any completed property: *"Repaint — same spec as March 2026"*. The prior job tree is the starting point; the wizard only asks what's changed.
→ This single button is the "why would I look anywhere else" feature. No other painter can offer it because no other painter has the data.

**W4. Per-property colour registers.** F1, multiplied: the paint spec for every property they manage, forever, searchable by address. For body corporate: the common-property register the committee can hand to the next manager.
→ Handovers between property managers stop losing the paint history — and the history lives with you.

**W5. Consolidated money.** All invoices across all properties; monthly statement PDF; per-property cost history; payment terms appropriate to trade (⚑5: terms, e.g. 14/30 days, and whether deposit-on-accept applies to trade accounts at all).

**W6. Team access.** ⚑6 Multiple named users per commercial org (property managers come and go); a simple owner/member model to start.

**W7. Portfolio reporting.** ⚑7 (later phase) Quarterly PDF: jobs done, spend, properties painted, warranty positions. The report the strata manager forwards to the committee — with your name on every page.

---

## 7. Designed for a 60-year-old (bar #2)

These are laws for the build brief, inheriting the website's older-visitor rules:

1. **No passwords by default** (A2). The single decision that matters most.
2. **One primary action per screen**, phrased as the customer would say it: "See my estimate", not "View dashboard".
3. **Big type**: portal body ≥18px equivalent, generous tap targets, WCAG AA contrast (the ink/cyan palette passes — verify amber-on-ink in the build).
4. **The phone number never hides.** Header, every page, tappable.
5. **Plain words everywhere**: "Money" not "Billing"; "Your colours" not "Specifications"; "What's happening" not "Activity feed". No acronyms customer-side, ever.
6. **Nothing is ever a dead end**: every empty state and every error says what to do next and offers the phone number.
7. **Print works** for every document.
8. **English (not Australian) tone** for all customer-facing copy, per your standing rule — warm, plain, unhurried.

---

## 8. The trust ledger (bar #4)

Trust is built by *evidence shown at the right moment*, not by claims. Where each stage earns it:

| Stage | Trust move |
|---|---|
| Estimate | Itemised, plain-language lines; price ranges honest about uncertainty; liability cert + SWMS attached; 85+ reviews embedded (presentation blocks — decided) |
| Acceptance | Instant receipt; plain 4-step "what happens next"; deposit % visible and explained |
| Pre-start | Named people with photos; colour consult in their control |
| During | Daily photo evidence; PC-approved updates (no raw contractor comms); variations priced & approved in writing before work |
| Sign-off | They approve area by area; nothing is "done" until they say so |
| After | Completion report, warranty card, colour register — permanent, downloadable, theirs |

---

## 9. Retargeting the gap (your consideration #6) — built for volume

The wizard's early email capture (decided) means every gap-stage customer is reachable. Retargeting is a **state machine on estimate status** — no manual list-building, so it scales to any volume. It rides on CRM (phase 4) + follow-ups (phase 5, draft-only first month — decided).

### The states and their sequences

| State | Meaning | Sequence sketch (⚑8: cadence & copy are yours) |
|---|---|---|
| `started_not_finished` | Email captured, wizard abandoned | +1h: magic link "pick up where you left off — your answers are saved". +2d: "most people finish in 4 minutes" + book-a-call |
| `finished_not_saved` | Saw a price, didn't save | +1h: "your estimate is ready to keep" + save link |
| `saved_not_accepted` | The classic gap | +24h: "any questions about your estimate?" + AI helper + phone. +4d: social proof (reviews, before/afters for their job type). +8d: "want us to confirm the price? Book a free visit". +20d: gentle check-in. +50d: "your price is held for 60 days — 10 days left" (true urgency from the decided validity rule, never fake) |
| `viewed_not_responded` | Opened repeatedly, silent | View-tracking spike → **human-touch task** in PC console: a person calls. High engagement deserves a human, not another email |
| `accepted_not_paid` | Yes, but deposit unpaid | Handled by the invoice chase ladder (phase 2, decided) |

### Volume-ready rules

Fully automatic sequences with **human-touch triggers by value and behaviour**: estimate over a threshold (⚑9, e.g. $10k) or repeated views → call task instead of email #2. Every message: magic-link deep into the portal, "speak to a person" block, one-tap unsubscribe (consent per AU law — decided). Sequences stop instantly on any state change or inbound contact. All sends logged to the communications hub, so a customer who calls is never mid-conversation with a robot they can't see. Channels: email + SMS (provider already ⚑ in phase 5).

**The retargeting asset nobody else has:** the message isn't "still interested in painting?" — it's *"your hallway-included estimate for 12 Smith St is saved and the price is held until 14 October."* Specific, personal, honest.

---

## 10. Built for volume (Tom's ruling, 26 Aug)

The design assumption is **thousands of new customer portals a year** — tens of new accounts a day in peak marketing periods, and compounding: within three years that's tens of thousands of accounts and hundreds of thousands of photos. Next.js + Supabase handles this scale comfortably, but only if the volume habits are built in from day one — retrofitting them later is the expensive path. These are the laws for the build brief:

1. **Self-service by default.** Every flow — account creation, magic links, estimating, acceptance, payment, warranty claims — completes with zero staff touch. Humans enter only at the defined value and behaviour triggers (§9, WO loop). Staff effort must scale with *jobs won*, never with *portals created*: a marketing spike that creates 500 portals in a week should create zero extra admin.
2. **The event log renders the portal.** Timeline, comms hub, warranty history and the PC console all read from the existing event-log source of truth (wo_events / CRM events). One indexed query pattern serves every customer; there are no bespoke per-feature queries to keep fast.
3. **Photos are the real load.** Originals go to storage once (upload validation per the remediation plan); the portal serves thumbnails and sized renditions via CDN with signed URLs. A phone timeline never downloads an original. At 500k photos this is the difference between a fast portal and a slow one.
4. **Paginate and index everything.** Every list — timelines, invoices, properties, the portfolio dashboard — is paginated, and every query is keyed and indexed on `account_id / property_id / job_id`. RLS policies must be backed by those same indexes: RLS at 50k accounts is only as fast as the indexes under it. No unbounded reads anywhere (the audit's S5 lesson, applied to the customer side before launch rather than after).
5. **Queue the fan-out.** Retargeting sequences, notifications and invoice chase ladders run from a scheduled job queue, never inline in a request. Sends are idempotent and retryable; a nightly run that processes 10,000 due messages is normal operation, not an incident.
6. **AI cost gates are volume gates.** Plan-reader and chat calls are the only per-account cost that scales with signups; the residential 2-session limit (§3) is the cost control as well as the sales funnel, and commercial-unlimited is fine because trade volume converts. Admin dashboard tracks AI spend by account type, with an alert threshold ⚑15.
7. **Performance is proven at volume before launch, not discovered after.** A seeded load dataset (order of 25k accounts, 60k jobs, 500k photos) runs in the test environment (the dedicated test Supabase project already recommended in the audit response), and the acceptance gate is measured against it: portal home and timeline p95 under ~500ms, wizard save under 1s, nightly sequence run inside its window. Exact figures for Tom to bless ⚑14 — the shape is the law.

---

## 11. Where this fits the buildout

| Portal piece | Depends on | Status |
|---|---|---|
| Estimate view in portal, AI helper hooks | Wizard rebuild (R1–R5) | In progress |
| Project Timeline, variations, sign-off, completion report | Phase 1: WO completion loop | Brief written (claude-code-brief-wo-loop-pc-command.md) |
| Money pages, deposit flow, PDFs, chase ladder | Phase 2: invoicing & payments | Next after phase 1 |
| Portal shell, colour register, comms hub, commercial workspace, Documents | Phase 3: **this document** | Being designed now |
| Accounts → properties → jobs identity model | Resolves customer-identity-link.md (audit follow-up) — currently blocking invoicing's customer half, the portal, and CRM leads | **First job of phase 3a** |
| Embedded estimate builder (B4) | Wizard rebuild (R1–R5) — same components, no fork | In progress |
| Retargeting sequences | Phases 4–5: CRM + follow-ups | Specced in buildout order |
| AI chat (B2) | Phase-2 chat track | Deferred by design; portal ships without it |

Suggested build split when we get to the brief: **3a** identity model (accounts/properties/jobs + estimate/invoice linking) + portal shell + auth + estimate/money/timeline, built against the seeded volume dataset from day one (residential complete, multi-property included) → **3b** colour register + Documents + comms hub + aftercare + embedded builder entry points → **3c** commercial workspace → volume gate (§10.7) before launch → retargeting lands with phases 4–5.

---

## 12. ⚑ Business decisions for Tom

1. **Floorplan unblock path** — phone call only, or also a "request unlock" button that creates a PC task? Auto-expire the block after staff review?
2. **Trade account granting** — who approves, what checks (ABN?), and is there a "request trade access" form or invite-only like contractors?
3. **Passwordless default** — magic-link-only for residential OK? Password required for commercial users?
4. **Colour register source of truth** — finalised colour schedule, actual materials ordered, or schedule reconciled against materials at job close?
5. **Commercial payment terms** — deposit-on-accept for trade too, or terms (14/30 days)? Statement cycle?
6. **Commercial team users** — multiple logins per org at launch, or single login for v1?
7. **Portfolio reporting** — worth building, and when?
8. **Retargeting cadence & thresholds** — the sequence table in §9 is a sketch; day gaps, message count, and the human-touch dollar threshold are yours.
9. **High-value human-touch threshold** — the $ figure above which a person calls instead of email #2.
10. **Portal name** — customer-facing: "My Paint Group"? "Your project"? (Affects nav copy and email templates.)
11. **Notification defaults** — SMS on by default for job-day updates, or email-only until opted in?
12. **Residential limits: per account or per property?** The 2-estimates and 2-floorplan-session limits are currently per email/IP. With multi-property accounts, does a mover who used both floorplan sessions on the old house get fresh sessions for the new address, or does the limit stay account-wide (with the office unblock as the pressure valve)? Per-property is friendlier and still capped; account-wide is a tighter cost gate.
13. **Documents set and ownership** — which certificates go on display (public liability, workers' comp, others?), who keeps them current, and does the amber expiry warning go to you or to Admin?
14. **Volume acceptance figures** — bless or adjust the load-test targets in §10.7 (25k accounts / 60k jobs / 500k photos seed; p95 ~500ms portal reads; wizard save <1s).
15. **AI spend alert threshold** — the monthly figure at which the admin dashboard warns you about plan-reader/chat costs.

---

## 13. Reference files

- `post-wizard-buildout-order.md` — portal is phase 3; this doc details it
- `claude-code-brief-wo-loop-pc-command.md` + `work-order-completion-workflow.md` — source of every Timeline/sign-off event
- `work-order-lifecycle-mockup.html`, `pc-command-mockup.html` — design language for stage rails/pipelines to re-cut customer-side
- `acceptance-to-paid-workflow.md` — invoice/chase content for the money pages
- `claude-code-brief-presentations.md` — estimate-view content blocks the portal inherits
- Website experience plan (`website-experience-plan.md`) — older-visitor rules and portal demo sections that must match the real thing
- Wizard rebuild bundle (`docs/briefs/`) — account-creation-on-save and customer-view contract the portal extends; B4 embeds these same components
- `customer-identity-link.md` + `audit-response-and-actions.md` — the accounts/properties/jobs model in §3 is the resolution of this tracked item; the dedicated test Supabase project recommended there is where the §10 volume dataset lives
- `paint-group-workmanship-warranty.md` — the warranty terms and card that the Documents space (§5) serves

## 14. What good looks like (acceptance-level outcomes)

- A first-time homeowner goes from wizard → saved estimate → portal without ever seeing a registration form or creating a password.
- A 60-year-old can, unaided: open their estimate from a text message, see today's photos, download an invoice PDF, and find the phone number — each in under 30 seconds.
- During an active job, the customer sees new photos the same day the contractor ticks the surface, with zero extra work by contractor, PC or office.
- Six months after completion, a customer logs in and reads the exact brand, colour code and sheen on any wall of their house, and can download it as a PDF.
- A property manager quotes an end-of-lease repaint for a saved property in under 2 minutes, and rebooks a prior spec in one tap.
- Every retargeting message deep-links into the portal, stops on any state change, and always offers a human.
- No customer-facing view ever exposes margins, contractor rates, or another customer's data (RLS + explicit view param, per the standing rule).
- A homeowner adds a second address to their existing account in under a minute, keeps every record from the first home, and never sees anything called "commercial" or "trade".
- A logged-in customer starts a new estimate from a saved property and reaches a price without re-entering anything the account already knows; residential hits the AI gates exactly as the public wizard does, commercial never hits them.
- Any customer can download our current insurance certificate and their warranty card from Documents without asking us; an expired certificate can never be the one on display.
- With the volume dataset seeded (25k accounts / 500k photos), portal home and timeline meet the p95 targets, and a nightly sequence run completes inside its window — measured before launch.

---

## Suggested next steps

1. You rule on the ⚑ list (especially 1–5 and 12 — they shape the schema; 14 sets the launch gate).
2. I turn this into a single-file HTML mockup of the four key screens — state-aware home, Project Timeline, Your Colours, commercial portfolio dashboard — phone-first so you can feel it on your phone.
3. Then the Claude Code build brief for phase 3a, with reference files and acceptance criteria per your standard format.
