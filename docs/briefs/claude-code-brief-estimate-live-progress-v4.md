# Claude Code brief: live progress phone view on the estimate (v4)

**Repo:** paint-group-platform (Next.js App Router, TypeScript, Tailwind, Supabase)
**Date:** 19 Sept 2026 · **Owner:** Tom Roman
**Supersedes:** v1, v2 and v3. Tom's v4 rulings: **the section is the phone and nothing else** (headline, intro and the four points are removed), and the **commercial wording reads as a commercial job** (no bedroom, bathroom or kitchen labels). Tom's ruling after seeing both: build the **phone view from the first mockup**, synced to the customer's details and address, shown **only when a presentation is attached to the quote**, with **two sets of messaging**: residential, and commercial/trade.
**Type:** fill-in track. Customer-facing, read-only, touches no money paths.
**Rulings applied 19 Sept 2026 (session 1):** see section 11. The flags there are RULED, not open; the rulings are folded into the sections they touch.

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
| `presentations-summary-for-dashboard.md` + the shipped presentations code | `docs/briefs/`, `lib/presentations/`, `app/(app)/settings/PresentationsManager.tsx`, `app/e/[token]/PresentationBlocks.tsx` | How presentations attach to an estimate. `claude-code-brief-presentations.md` was never committed (Tom, 19 Sep); the shipped code is the truth and this section is gated on `snapshot.presentation.blocks`. |
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
6. **Honest labelling.** A visible label "Example of your live updates" sits directly above the phone (not fine print) and the "For illustration only" line sits under it (section 6). Both come from the templates file and both are visible in reduced-motion mode. Every photo carries a "Before · your photo" / "Before · site photo" tag.
7. **All customer-supplied text is escaped** before it is placed in the phone (names and addresses are user input).
8. **Locked design system.** Switzer, Martian Mono, existing tokens. English tone, not Australian.

## 4. When it shows, and which messaging

**Shows:** estimate has a presentation attached (`snapshot.presentation.blocks` non-empty, decided server-side). Otherwise nothing renders. Every attached presentation carries it; there is no per-presentation switch (F6). Staff-sent estimates only: wizard self-built estimates showing a price range never show it (F9).

**Messaging set (Tom, 19 Sep, F5):** an estimate linked to an account whose `accounts.account_type = 'trade'` gets the commercial/trade set. Everything else, including estimates with no linked account, gets residential. There is no presentation type column and no migration for this. The account type is not in the snapshot; the server reads it by token through the service client, the way `page.tsx` already reads bank details.

Unit tests cover three cases: trade account, residential account, no account.

## 5. Syncing to the customer's details

One pure function in `lib/` (unit-testable under vitest):

`buildProgressPreview(estimateCustomerPayload, messagingSet) -> ProgressPreview`

Reads: first name, surname, organisation name, street address, suburb, property photos, area names in estimate order, products by surface, job type, property references (PO, owner reference) if present.

Required fallbacks, each with a unit test:
- **No first name:** headline drops the name ("This is how you'll follow the work at {street_address}"); texts open "Good morning." with no name.
- **No street address:** use "your property" in copy; the phone header shows the suburb alone. If neither exists, the section does not render.
- **No property photos:** the phone still plays, text only. No photo from any other source, ever (F2).
- **Fewer than 3 areas:** never repeat an area within one update; shorten the sentence.
- **Exterior job:** exterior templates (wash-down, preparation, priming, top coats, walkthrough) using elevation names. Interior plus exterior: interior templates with one update mentioning the exterior.
- **Trade, no PO or owner reference on the estimate:** leave them out entirely. Never display an invented reference on a live estimate. (The mockup's "PO 4471" is sample data.)
- **Photos (F2 + F13, RULED):** only the customer's own before photos already in the sent snapshot (`areas[].photos`, the "Your property, as we saw it" set). Spread across the updates in snapshot order, at most 2 per update, no photo used twice; when the photos run out, later updates simply have none.
- **Demo painter (F1, RULED):** one Settings value, "Demo painter", chosen from the painters list at Settings → Website (`website_content.painters[]`, fields `name` + `photoPath`). If none is set, or the chosen painter has no photo: "Your lead painter" / "Site supervisor" with the generic avatar, and the texts say "the team have arrived". Unit tested both ways.
- **Long names and addresses:** ellipsis inside the phone header; texts wrap. Nothing overflows the frame. Test with a 60-character address.

All wording lives in one templates file so it can move into Settings later. No wording editor in this brief.

## 6. The two messaging sets

All messaging now lives on the phone: the two texts, the job header, and the five updates. Outside the phone there are exactly three things, all from the templates file: the label **"Example of your live updates"** directly above the phone, the "Play again" button, and the "For illustration only" line beneath. Photos carry the tag **"Before · your photo"** (residential) or **"Before · site photo"** (commercial). There are no example photos from other jobs in either set.

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
| Label above the phone | Example of your live updates |
| Line under the phone | For illustration only. This is an example of the updates you'll receive, shown with your address and your own photos. The days, times, messages and the painter shown are examples, not your actual schedule. |

### 6b. Commercial and trade: a commercial job, start to handover

The vocabulary is commercial throughout: site induction, sign-in, SWMS, work zones, trading hours, after-hours works, programme, variations, daily report, practical completion, handover. **Residential room words (bedroom, bathroom, kitchen, lounge, "your home") must never appear in this set's template wording.** Area names still come from the estimate, so a commercial estimate supplies commercial areas. The mockup uses sample areas (Reception, Lift lobby, Corridors, Stairwell, Open-plan office, Boardroom, Meeting rooms) because the example estimate is a house. All commercial lines (daily report to recipients, tenant notice, after-hours, low-odour products, colours recorded, quality check passed) stay; the example labelling covers them (F4 + F7).

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
| Photo tags | "Before · site photo" on every photo. All photos are the estimate's own. |
| Label above the phone | Example of your live updates |
| Line under the phone | For illustration only. This is an example of the updates you and your team will receive, shown with your address and your own site photos. The days, times, messages, references and the supervisor shown are examples, not your actual programme. |

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

1. Example estimate (Ben Guptill, 43 Keith Street, Alphington): both texts and the phone header show his first name and address; updates name real rooms from his estimate; at least two of his own photos appear. Grep proves no customer data is hard-coded.
2. A second estimate with a different customer, address and rooms shows its own details with no code change.
3. **No presentation attached:** the section, the hero button and the step-4 link are all absent from the HTML, and no preview JavaScript or preview images are requested. Asserted in e2e.
4. Attaching a presentation to that same estimate makes all three appear without any other change.
5. Messaging set follows the section 4 rule. Unit tests cover three cases: trade account, residential account, no account.
6. Every fallback in section 5 has a passing unit test. `buildProgressPreview` is pure.
6b. No image in the section comes from any source other than this estimate's own photos. Asserted in e2e.
6c. The "Example of your live updates" label and the "For illustration only" line are present whenever the section renders, including under reduced motion. Asserted in e2e.
6d. Demo painter set in Settings shows that painter's name and photo; unset shows the generic fallback. Unit tested both ways.
7. A name or address containing `<script>` or quotes renders as plain text.
8. The phone renders the shared portal progress component (`app/account/(portal)/JobTimeline.tsx`) through a prop that supplies a synthetic project and public photo URLs. One component, no fork. Both portals behave exactly as before, proven by their existing tests plus one new test. The synthetic path never signs or reads storage. Proven by import path.
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

## 11. Rulings (Tom, 19 Sept 2026). These are decided; do not reopen.

- **F1. Lead painter shown: RULED.** A real painter from the painters list at Settings → Website, by name and photo — not necessarily the painter who will do the job. One Settings value, "Demo painter", chosen from that list. Unset, or no photo: "Your lead painter" with the generic avatar and "the team have arrived". The same person is "Site supervisor" in the commercial set. The example line says the person shown is an example. The value lives on the existing `website_content` settings row (jsonb), so no migration.
- **F2 + F13. Photos: RULED.** Only the customer's own before photos from the sent snapshot. No example photos from other jobs anywhere, in either set. Tags "Before · your photo" / "Before · site photo". Snapshot order, max 2 per update, never twice; fewer photos than slots = later updates without photos; zero photos = text only. The presentation-media example images and the "Example · recent job" tag are removed from the build and from the mockup reference.
- **F3. Day count:** keep "Day 1 … Day 7" as illustrative; the F4 label covers it.
- **F4 + F7. Example labelling: RULED.** Keep both sample texts and every commercial line. Label the whole thing: "Example of your live updates" above the phone, and the "For illustration only" line under it (section 6, one per set). Both from the templates file, both visible under reduced motion. Separately, not blocking: the "arrival text" and "job finished / walkthrough text" are recorded in `docs/briefs/messaging-automations-inventory.md` as gaps to be built.
- **F5. Which set: RULED.** Trade account → commercial; everything else → residential. No presentation type column, no migration. (Section 4.)
- **F6.** No off switch; every attached presentation carries the section.
- **F8.** Placement below scope of works, above the paint section (already ruled).
- **F9.** Staff-sent estimates only; wizard self-built estimates never show it.
- **F10.** Preview line replaced by the F4 wording.
- **F12.** After-hours line on every commercial preview.
- **F11.** Deleted; superseded by F5.
- **F14 (Tom, 20 Sep 2026, after seeing it live): PLACEMENT RE-RULED — supersedes F8, the hero button and the step-4 link.** "Move the phone demo so it is always fixed in 'A few extra details' as its only tab which can be clicked on — make it stand out and glow… I think it might be a bit overkill." The phone is no longer inline. It lives behind ONE glowing card appended to the presentation's first capability panel ("A few extra details" on the live presentations; a presentation with no capability panel gets the card in a panel of its own after its blocks): heading "Receive live on-the-job updates as your job progresses", body "Click here to see a demo of your live updates." Pressing the card mounts the phone full-width under the cards (the phone's own in-view autoplay then starts it); pressing again closes it. The card is the only entry point: the hero's "See how you'll follow the job" and the step-4 "See it for your address" link are removed. `cta_clicked` now means the card press. The glow is a CSS animation on the card alone, off under reduced motion and once open. Acceptance 12b/13's placement assertions are replaced by: closed by default, one card in the capability grid, opens/closes, only-the-phone inside. Same gate (presentation attached, staff-sent), same messaging sets, same tracking.

**Approved approach (session 1):** JobTimeline extended via a prop (synthetic project + public photo URLs; the client reveals rendered items one by one), on three conditions: one component with no fork; both portals behave exactly as before, proven by their existing tests plus one new test; the synthetic path never signs or reads storage. Gate on `snapshot.presentation.blocks`, server-side. Insertion between scope of works and "The paint we're supplying". Tracking via the dashboard 0a route pattern plus `lib/crm/events.ts` registry entries. Merge order: warranty branch first, then this branch rebased onto it.

## 12. Out of scope

Any selling copy beside the phone, a desktop frame, changes to the real portal, messaging automations, pricing, the acceptance flow, a Settings editor for the wording, and the marketing site's generic portal animation.
