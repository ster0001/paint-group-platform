# Claude Code brief: live progress phone view on the estimate (v4)

**Repo:** paint-group-platform (Next.js App Router, TypeScript, Tailwind, Supabase)
**Date:** 19 Sept 2026 · **Owner:** Tom Roman
**Supersedes:** v1, v2 and v3. Tom's v4 rulings: **the section is the phone and nothing else** (headline, intro and the four points are removed), and the **commercial wording reads as a commercial job** (no bedroom, bathroom or kitchen labels). Tom's ruling after seeing both: build the **phone view from the first mockup**, synced to the customer's details and address, shown **only when a presentation is attached to the quote**, with **two sets of messaging**: residential, and commercial/trade.
**Type:** fill-in track. Customer-facing, read-only, touches no money paths.

## 1. What we are building

A new section on the customer estimate view (`/e/[token]`) containing a phone, centred, and nothing else apart from a "Play again" button and one small preview line beneath it. No headline, no intro paragraph, no bullet points: if a build adds selling copy beside the phone, it is wrong. A text message arrives on the phone's lock screen, it gets tapped, and the customer's job opens: their address, the painter in charge, and day-by-day updates with photos appearing one after another, ending with a "finished, walkthrough booked" text.

Everything on the phone is read from the estimate being viewed: first name, address, suburb, their own enquiry photos, their real room names and paint products. It should look like their job, as it will look if they accept.

Phone only. There is no desktop frame in this version.

## 2. Reference files (read first)

Commit these, then confirm the file list back to Tom before writing code. If any reference cannot be found, **STOP and report** (per CLAUDE.md).

| File | Where | Purpose |
|---|---|---|
| `estimate-live-progress-mockup-v4.html` | `design/reference/` | The approved look, layout, animation order and timings, and both messaging sets. The amber panel at the top is mockup-only: it lets Tom change the customer details, switch account type, and switch the presentation on and off. None of it is customer-facing. |
| This brief | `docs/briefs/` | Scope, rules, messaging, acceptance criteria, flags. |
| `claude-code-brief-presentations.md` | in `docs/briefs/` | How presentations attach to an estimate. This section is gated on that. |
| `claude-code-brief-customer-portal.md`, `claude-code-brief-trade-portal-v2.md` | in `docs/briefs/` | The real job progress view. The phone must reuse it (rule 1). |
| `docs/briefs/messaging-automations-inventory.md` | in repo | The real customer texts. The two sample texts must match automations that exist or are committed. |
| Live example | `https://login.paintgroup.com.au/e/YoEvfdOBKW6DIEXJnMKJgKj4HzA7` | The estimate view today. |

In session 1, locate and report the actual paths of: the estimate view route and its section components, where an estimate's attached presentation is resolved, the shared portal progress/timeline component, where account type is stored, and the estimate view-tracking code. Do not guess any of them.

## 3. Rules that are not negotiable

1. **One progress component.** The phone renders the real shared portal progress component with sample data. Do not build a lookalike. If it does not exist in a shared location yet, STOP and report.
2. **Presentation gate.** The section renders only when the estimate has a presentation attached. No presentation means no section, no hero button, no step-4 link, and none of its JavaScript or images loaded. Decided server-side.
3. **Read-only.** No database writes except tracking events (section 8).
4. **Deterministic, no AI, no prices.** The content is built by a plain function from the estimate, using templates.
5. **`view=customer` contract.** Only fields already in the customer payload reach the browser. No margins, hours, contractor amounts or internal notes.
6. **Honest labelling.** The small preview line under the phone stays. Example photos carry an "Example" tag on the image.
7. **All customer-supplied text is escaped** before it is placed in the phone (names and addresses are user input).
8. **Locked design system.** Switzer, Martian Mono, existing tokens. English tone, not Australian.

## 4. When it shows, and which messaging

**Shows:** estimate has a presentation attached. Otherwise nothing renders.

**Messaging set:**
1. If the estimate's customer is linked to an account, use the account type: `trade` gets commercial/trade messaging, `residential` gets residential.
2. If no account is linked, use the type of the attached presentation (a commercial presentation gets commercial/trade messaging).
3. Otherwise residential.

See flags F5 and F6. Report in session 1 how many current estimates have a linked account, as earlier audits found most do not.

## 5. Syncing to the customer's details

One pure function in `lib/` (unit-testable under vitest):

`buildProgressPreview(estimateCustomerPayload, messagingSet) -> ProgressPreview`

Reads: first name, surname, organisation name, street address, suburb, property photos, area names in estimate order, products by surface, job type, property references (PO, owner reference) if present.

Required fallbacks, each with a unit test:
- **No first name:** headline drops the name ("This is how you'll follow the work at {street_address}"); texts open "Good morning." with no name.
- **No street address:** use "your property" in copy; the phone header shows the suburb alone. If neither exists, the section does not render.
- **No property photos:** example photos only, all tagged "Example".
- **Fewer than 3 areas:** never repeat an area within one update; shorten the sentence.
- **Exterior job:** exterior templates (wash-down, preparation, priming, top coats, walkthrough) using elevation names. Interior plus exterior: interior templates with one update mentioning the exterior.
- **Trade, no PO or owner reference on the estimate:** leave them out entirely. Never display an invented reference on a live estimate. (The mockup's "PO 4471" is sample data.)
- **Long names and addresses:** ellipsis inside the phone header; texts wrap. Nothing overflows the frame. Test with a 60-character address.

All wording lives in one templates file so it can move into Settings later. No wording editor in this brief.

## 6. The two messaging sets

All messaging now lives on the phone: the two texts, the job header, and the five updates. There is no copy outside the phone except the preview line.

Placeholders: `{first_name}` `{street_address}` `{lead}` (see F1) `{areas_a}` `{areas_b}` `{areas_c}` (groups of area names from the estimate, in order) `{ceiling_product}` `{wall_product}` `{po}` `{link}`.

### 6a. Residential: their home, their rooms, a person by name

| Element | Copy |
|---|---|
| First text | Good morning {first_name}. {lead} and the team have arrived at {street_address}. Follow today's progress: {link} |
| Person card | {lead} · Your lead painter |
| Day 1 | **Set-up and protection.** Floors covered, furniture moved to the centre of each room and wrapped. Filling and sanding under way in the {areas_a}. |
| Day 2 | **Preparation finished.** Cracks filled and sanded in {areas_b}. |
| Day 3 | **Ceilings and cornices.** Two coats of {ceiling_product} in the {areas_a}. |
| Day 5 | **Walls, first coat.** {wall_product} going on in the {areas_c}, in the colours you chose at your consultation. |
| Day 7 | **Final walkthrough booked.** 2pm today with {lead}. You'll walk every room together, and anything you spot is put right before the final invoice. |
| Last text | {first_name}, {street_address} is finished. Your walkthrough with {lead} is at 2pm today. |
| Preview line | A preview built from your estimate. The room names and first photos are yours. Later photos are examples from a recent job, and {lead} is shown as a sample until your lead painter is confirmed at booking. |

### 6b. Commercial and trade: a commercial job, start to handover

The vocabulary is commercial throughout: site induction, sign-in, SWMS, work zones, trading hours, after-hours works, programme, variations, daily report, practical completion, handover. **Residential room words (bedroom, bathroom, kitchen, lounge, "your home") must never appear in this set's template wording.** Area names still come from the estimate, so a commercial estimate supplies commercial areas. The mockup uses sample areas (Reception, Lift lobby, Corridors, Stairwell, Open-plan office, Boardroom, Meeting rooms) because the example estimate is a house. See flag F11 for trade accounts quoting on houses.

| Element | Copy |
|---|---|
| First text | {street_address} ({po}): Paint Group signed in on site at 6:30am. {lead} is your site supervisor. Live progress: {link} |
| Person card | {lead} · Site supervisor |
| Header extras | PO and owner reference (only if on the estimate); stage rail: Pre-start, In progress, Quality check, Walkthrough, Closed; chips: Certificate of currency, SWMS, Daily reports |
| Day 1 | **Site induction and set-up.** Team inducted and signed in. SWMS reviewed with your site contact, work zones barricaded and signed, floors and fixtures protected in {areas_a}. Chips: SWMS on site, Tenant notice posted. |
| Day 2 | **Preparation complete, common areas.** {areas_b} patched, sanded and spot-primed. Access kept clear throughout trading hours. Daily report sent to your recipients. |
| Day 3 | **After-hours works, {area}.** Ceilings and walls completed after close using low-odour products. Area cleaned and reopened for trading at 7am. Chips: Out of hours, On programme, Variations 0. |
| Day 5 | **{areas_c}.** Two coats to walls, completed in stages around your staff. Colours recorded against the property. |
| Day 7 | **Practical completion and handover.** Quality check passed. Walkthrough at 2pm with your site contact. Signed completion report, photo record and colour schedule filed to the property. |
| Last text | {street_address} ({po}): works complete and site cleared. Handover walkthrough at 2pm. Completion report to follow. |
| Photo tags | "Site photo" for theirs, "Example · recent job" for examples. Example photos in this set must come from a commercial job. |
| Preview line | A preview built from your estimate. The address and first photos are from your property. Later photos are examples from a recent job; any reference numbers and the supervisor shown are samples. |

## 7. Behaviour

- **Placement (ruled):** directly below "Scope of works, item by item", above "The paint we're supplying". Fixed position, not reorderable. If the scope section is long, the phone must still only start playing when it scrolls into view.

- Plays once when 40% of the phone is in view, then loops after a 6.5-second hold. "Play again" restarts. Pauses when off-screen or the tab is hidden; resumes from the start. Never two sequences running at once.
- `prefers-reduced-motion`: no animation. Show the final state (all updates visible, last text showing).
- Phone is `aria-hidden`; a visually hidden text summary tells the same story. "Play again" is a real button with visible focus.
- Images lazy-load with fixed dimensions (no layout shift) using the URL approach the estimate view already uses. A failed image leaves a neutral tile.
- No horizontal page scroll at 360px. Under 380px the phone scales down slightly.
- Excluded from the print stylesheet and the PDF.
- With a presentation attached, the hero gains a secondary button "See how you'll follow the job", and step 4 of "What happens when you accept" gains a link up to the section.

## 8. Tracking

Through the existing estimate view-tracking path (and `crm_events` if it exists at build time; otherwise one adapter function, and report): `progress_preview_started`, `progress_preview_completed`, `progress_preview_replayed`, `progress_preview_cta_clicked`, each with the messaging set as a property. Once per type per page load, except replay.

## 9. Acceptance criteria

1. Example estimate (Ben Guptill, 43 Keith Street, Alphington): the headline, both texts and the phone header show his first name and address; updates name real rooms from his estimate; at least two of his own photos appear. Grep proves no customer data is hard-coded.
2. A second estimate with a different customer, address and rooms shows its own details with no code change.
3. **No presentation attached:** the section, the hero button and the step-4 link are all absent from the HTML, and no preview JavaScript or preview images are requested. Asserted in e2e.
4. Attaching a presentation to that same estimate makes all three appear without any other change.
5. Messaging set follows the section 4 rule. Unit tests cover: trade account, residential account, no account with commercial presentation, no account with residential presentation.
6. Every fallback in section 5 has a passing unit test. `buildProgressPreview` is pure.
7. A name or address containing `<script>` or quotes renders as plain text.
8. The phone renders the shared portal progress component. Proven by import path.
9. Trade set with no PO on the estimate shows no reference anywhere.
10. Network inspection as an anonymous customer shows no staff-only fields. Asserted in e2e.
11. No database writes other than the tracking events. Proven by test.
12. Reduced motion: nothing animates; final state shown.
12b. In the rendered page the section is the next sibling after the scope of works section and before the paint section. Asserted in e2e.
13. 360px: no horizontal scroll, phone fully visible. 1280px: phone centred, matching the mockup. The section contains no headline, intro or bullet copy.
13b. The commercial set's template wording contains none of: bedroom, bed, bathroom, bath, kitchen, lounge, laundry, home. Asserted by a unit test over the templates file.
14. Not present in print preview or the PDF.
15. Lighthouse on the estimate page: performance drops by no more than 3 points; cumulative layout shift under 0.05. An estimate without a presentation shows no change at all.
16. e2e as an anonymous customer on a token URL against the **test** Supabase project (never production): open, scroll to the section, wait for the last text, press "Play again", then accept the estimate. Acceptance works exactly as before.
17. `typecheck`, `lint` and the full unit suite are green. No `any`, no TODOs.
18. Staff help file added under `docs/help/`: what the section is, that it appears only when a presentation is attached, and how the messaging set is chosen.

## 10. Suggested sessions

1. **Locate and confirm.** Commit references, report file paths, the state of the shared progress component, how presentations attach, and the linked-account count. List the flags back to Tom. No code.
2. **Preview builder:** templates for both messaging sets, fallbacks, escaping, unit tests.
3. **Phone and sequence:** lock screen, texts, job view, highlight sync, reduced motion, visibility pausing.
4. **Gating and selection:** presentation gate, messaging-set rule, hero button, step-4 link, print exclusion.
5. **Tracking, e2e, Lighthouse, help file.** Report against every acceptance criterion by number.

Any migration runs between gate runs, never during one. Tom pastes the SQL.

## 11. Decisions for Tom (⚑). Do not invent answers.

Build with the stated default, keep each as one constant or Settings value, and list them back at the end of session 1.

- **F1. Lead painter shown.** Nobody is assigned before acceptance, and only consenting painters are shown publicly. (a) No name: "Your lead painter", generic avatar, texts say "The team have arrived"; (b) a consenting painter chosen in Settings, labelled as a sample. *Default: (b) if one is set, else (a).* "Jacob" in the mockup is a placeholder.
- **F2. Later photos.** Their property is not painted yet. (a) Their own photos early, real job photos tagged "Example" later; (b) their own only; (c) AI-rendered "after" images of their rooms. *Default: (a). Recommend against (c).* Also: which job's photos are used as examples, and whether that customer's marketing consent covers it.
- **F3. Day count.** "Day 7" implies a programme length on an unaccepted quote. (a) Keep, as illustrative; (b) derive from estimated hours and crew size; (c) weekday names only. *Default: (a).*
- **F4. The texts must be true.** Arrival text, end-of-day text, finished text: confirm each is sent today or is committed. If end-of-day updates are approved by the project coordinator and not guaranteed daily, the day-by-day updates on the phone should not all show a late-afternoon time. *Default: mockup wording, for Tom to check against the messaging inventory.*
- **F5. How "commercial/trade" is decided** when no account is linked. *Default: section 4 rule.* A manual override per estimate is not included unless Tom asks.
- **F6. Should every presentation carry it, or should there be an off switch per presentation?** Tom's instruction is "only when a presentation is added". *Default: automatic with every presentation, no switch.*
- **F7. Trade promises.** Daily report to nominated recipients, PO and owner references, SWMS on file, after-hours works, low-odour products, tenant notices, a quality check before handover, completion report, colours recorded against the property. Confirm each is built or committed before clients see it. *Default: drop any line whose feature or practice Tom has not confirmed.*
- **F8. Placement: RULED by Tom.** The section sits directly below "Scope of works, item by item" and above "The paint we're supplying". Not a flag any more. The existing "One contact, live reporting" tile stays.
- **F9. Wizard self-built estimates** still showing a price range: show it or not. *Default: no, staff-sent estimates only.*
- **F10. The preview line wording,** and whether it joins the clauses already queued for a legal look. *Default: mockup wording.*
- **F11. Trade accounts quoting on houses** (for example a real estate agent repainting a rental). Area names come from the estimate, so "Bed 1" could appear inside commercial wording. (a) Keep the commercial set and let the area names show; (b) such estimates get the residential updates with the trade header (PO, stage rail, documents). *Default: (b), decided by the attached presentation's type being residential.*
- **F12. After-hours line.** Day 3 says works were done after close. Show it on every commercial preview, or only when the estimate is flagged as out-of-hours work? *Default: every commercial preview, worded as an example.*
- **F13. Commercial example photos.** Which commercial job supplies them, and whether that client's consent covers it.

## 12. Out of scope

Any selling copy beside the phone, a desktop frame, changes to the real portal, messaging automations, pricing, the acceptance flow, a Settings editor for the wording, and the marketing site's generic portal animation.
