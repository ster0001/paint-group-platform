# Build brief — Customer portal: UX quick wins + light mode

**Scope:** `login.paintgroup.com.au/account/*` (customer portal only). Not the website, not PC Command, not the wizard.
**Type:** Polish pass. No new modules, no schema changes, no rebuild. Every item below is a change to existing components or copy.
**Reviewed:** 25 Oct 2026, logged in as Tom (test account with ~20 addresses) at desktop width and 400px phone width.

---

## 0. Ground rules for this session

- Work on a feature branch `portal-ux-light` in its own worktree. **Production (`main`) is not touched until the whole brief is complete.** The live portal keeps running exactly as it is; the branch's Vercel preview is the only place the new one is seen until cutover. Never merge a partial stage. Walking skeleton first: ship the theme tokens (Part A) as the first commit so everything after is reviewed in light mode.
- **Replace, don't layer.** Every change edits the existing component or page in place. No `*-v2` files, no `new-*` folders, no feature flags, no duplicated components kept "just in case". When a component is superseded, the old one is deleted in the same commit.
- **No traces after cutover.** The run ends with a cleanup stage (plan §9) that removes dead tokens, dark-mode CSS, unused components, unused icons/images and any lingering references to "Invoicing" in portal nav/copy. The acceptance test is a grep, not a feeling.
- Do not touch data models, RLS, or the messaging adapter. If an item needs a new field, stop and report.
- Decisions marked ⚑ are Tom's. Do not invent them. Build the default stated and leave a `// ⚑` comment at the call site.
- Record rulings from this brief in the session ledger so they are not re-litigated.

### Reference files (Claude Code to confirm exact paths — stop and report if any are missing)
- `app/account/layout.tsx` — portal shell: header, sidebar, mobile bottom nav
- `app/account/page.tsx` — Home
- `app/account/project/page.tsx` — My project (timeline, areas, team)
- `app/account/colours/page.tsx` — My colours
- `app/account/money/page.tsx` — Invoicing (note: nav label says "Invoicing", route is `/money`)
- `app/account/messages/page.tsx` and `app/account/messages/[id]/page.tsx`
- `app/account/profile/page.tsx`
- `app/globals.css` / `tailwind.config.ts` — colour tokens (ink / graphite / cyan / paper / warm)
- Status chip component (wherever `KEEP SHAPING` / `READY FOR YOU` / `PAID 25 AUG` are rendered)
- The floating "Chat with us" widget component
- Mockup for reference: `customer-portal-light-mockup.html` (attached — open on phone)

---

## Part A — Light mode (do this first)

### A1. Tokens
Replace the dark defaults with a light palette. Keep the brand cyan for the logo and primary CTA; use a darker cyan for text/links so it passes contrast on white.

| Token | Dark (current) | Light (new) | Use |
|---|---|---|---|
| `--bg` | #0B0F14-ish | `#F6F5F1` (paper) | page background |
| `--surface` | #141A21-ish | `#FFFFFF` | cards |
| `--surface-2` | — | `#EFEEE9` | chips, inset rows, inputs |
| `--border` | #1F2730 | `#E3E1DA` | card and row borders |
| `--ink` | #FFFFFF | `#14181D` | headings, primary text |
| `--ink-2` | #9AA4AF | `#5A6370` | secondary text, helper copy |
| `--ink-3` | — | `#8A939E` | timestamps, meta |
| `--accent` | #35D5EF | `#35D5EF` | logo, primary button fill |
| `--accent-ink` | — | `#0E7490` | links, active nav, cyan text on white |
| `--ok` | green | `#1B7F56` on `#E6F4EC` | PAID, DONE, COMPLETE |
| `--warn` | amber | `#9A6A0F` on `#FBF1DC` | KEEP SHAPING, BEING CHECKED, NOT YET SUBMITTED |
| `--info` | cyan | `#0E7490` on `#DDF4F8` | READY FOR YOU, READY FOR YOUR WALKTHROUGH |
| `--shadow` | none | `0 1px 2px rgba(20,24,29,.06)` | cards |

### A2. Rules
- Primary button: accent fill, ink text (not white — contrast on #35D5EF fails with white).
- Secondary button: white, 1px border, ink text.
- Active nav item: `--accent-ink` text + `--surface-2` background.
- Header: white with bottom border. Sidebar: paper, right border.
- Mono font (Martian Mono) stays for **money, invoice/receipt numbers and status chips only** (see B1).
- Photos and swatches get a 1px border so they don't float on white.
- Light is the only theme. **Delete** the dark tokens and any dark-mode CSS, Tailwind `dark:` variants and theme-switch code in the portal — do not park them in a `[data-theme="dark"]` block. (Ruling, 25 Oct: no traces of the old system after cutover.)

### A4. Logo in the header (top-left)
The header must use the Paint Group logo, not styled text. Today the portal loads it from Supabase storage:
`estimate-media/logos/1786806613771-Color_logo_-_no_background.png` (3193×642, white "PAINT" + grey "GROUP" + cyan dot).
That file is built for a dark background and vanishes on white.
- Look in the same `logos/` folder in the `estimate-media` bucket, and in `public/`, for a dark-on-light variant (file name containing `black`, `dark`, `on-light` or similar). If found, use it and stop here.
- If not found, do **not** block: render the existing PNG with `filter: invert(1) hue-rotate(180deg)` (turns PAINT black, GROUP dark grey, keeps the dot cyan — this is what the mockup does) and leave a `// ⚑ A4 replace with proper dark logo asset` comment. ⚑ Tom to export a dark-on-light PNG/SVG from the brand files.
- Height 22px on mobile, 26px on desktop; the logo links to `/account`.
- [ ] Logo is legible on the white header at 360px and 1470px; it is the real mark, not text.

### A3. Acceptance
- [ ] Every portal route renders in light mode with no dark remnants (check: chat widget, bottom nav, inputs, PDF buttons, the 404 page).
- [ ] All text passes WCAG AA against its background (run axe or Lighthouse on Home, Project, Money).
- [ ] Primary CTA on Home and the Send button in Messages are the same component and look identical.

---

## Part B — Global (all pages)

### B1. Stop using mono uppercase for sentences
Mono caps is currently used for section headings, helper text, timestamps, chip labels, the "Ask the assistant" button and the email hint on Profile. On a phone it is slow to read. Rule: mono is for numbers (money, INV/RCT numbers, dates in chips) and status chips. Everything else — section headings ("My estimates", "Documents & warranty", "Day by day"), helper text, timestamps, button labels — goes to the body font in sentence case.
- [ ] No mono text longer than ~25 characters anywhere in the portal.

### B2. Header on mobile
At 400px the phone-number pill and the logo fight for space. Collapse the pill to a phone icon only below 640px (tap still calls). Keep the full number on desktop.
- [ ] Logo, phone icon and avatar fit on one line at 360px.

### B3. Floating "Chat with us" widget
It sits on top of content and overlaps the bottom nav on mobile. Either:
- (default) hide it on all `/account/*` routes — Messages is the canonical place and is one tap away in the bottom nav, or
- ⚑ keep it but raise it 72px above the bottom nav on mobile.
- [ ] Nothing covers the bottom nav on any portal page at 400px.

### B4. Whole-card tap targets
Estimate cards, message rows and invoice rows read as cards but only part of them is clickable in places. Make the whole card the link, add a right-chevron, and a pressed state (surface-2).
- [ ] Tapping anywhere on an estimate card on Home opens it.

### B5. Sign out
Only exists at the bottom of Home. Add it to the Profile page (bottom) and keep the one on Home.

---

## Part C — Home (`/account`)

### C1. Headline must match the stage
Currently: headline says "Your painting at 1/41 Devoy Street is **finished**" while the card below says "Ready for your walkthrough — nothing is done until you say so". These contradict. Drive the headline from the same stage that drives the card:
- walkthrough pending → "Your painting at 1/41 Devoy Street is ready for your look around"
- signed off → "…is finished"
- in progress → "…is underway"
- [ ] Headline and hero card never disagree.

### C2. Address chips — cap and collapse
A customer with many projects sees 20 chips before any content (test account exaggerates this, but agencies and landlords will hit it). Rules:
- Show "Everything" + the 4 most recently active addresses. Put the rest behind a "More (16)" chip that expands.
- Dedupe identical addresses. The test account shows "13 Leamington Crescent" four times. ⚑ Is that four real estimates for one address (then show once with a count) or duplicate wizard sessions that should be merged/hidden? Default: show once, count badge.
- [ ] At 400px the chip area is never taller than two rows before expanding.

### C3. Group the estimate list
Right now drafts, estimates awaiting Tom, and estimates ready for the customer are in one undifferentiated list. Group under three plain-English headings, in this order, each sorted by last activity (newest first), with a relative date on every card ("Updated 2 days ago"):
1. **Needs you** — READY FOR YOU, KEEP SHAPING, NOT YET SUBMITTED
2. **With us** — BEING CHECKED
3. **Done** — accepted / completed (collapsed by default)
- Keep the existing chip copy; it's good. Add the one-line "what next" under every card (BEING CHECKED currently has none → "We're checking the details — you'll hear from us within one business day").
- [ ] Every card shows: address, status chip, one-line next step, relative date.

### C4. Two CTAs that mean the same thing
"Get a new estimate" and "Add an address" — a customer can't tell the difference. ⚑ Default: one button, "Get an estimate for another property", which starts the wizard with the address step first. If "Add an address" exists so an agency can register a property without pricing it, keep it but label it "Add a property (no estimate yet)".

### C5. Hero CTA consistency
Hero card uses a full-width cyan button ("See my project"); the Documents card uses a tiny mono "OPEN" pill. Use the secondary button style for Documents ("Open documents").

---

## Part D — My project (`/account/project`)

### D1. Project switcher
The page shows one project with no way to change it. Add the same chip strip as Home (minus "Everything") above the title, or a dropdown on the address line. Deep-link from Home cards with `?project=`.
- [ ] A customer with three jobs can reach each project's timeline from this page.

### D2. "Variations — NOT STARTED" vs an approved extra
The area list says Variations: NOT STARTED, but the timeline shows "You approved an extra — $250.00 inc GST" on 27 Aug. ⚑ Either variations are a separate concept from extras (then rename the row "Extra work · 1 approved · $250.00 inc GST") or this is a status bug. Default: show the approved-extras count and total in that row, and drop "NOT STARTED" when count > 0.

### D3. Tense after sign-off
"Who's at your home — Josef, your painter" still shows after the job is complete. When stage = signed off, change the section heading to "Who painted your home" and the coordinator section to "Who looked after your job". Keep "Message me".

### D4. Photos
- Tap any photo to open a full-screen lightbox with the area label and swipe between photos in that entry.
- Show a count on the entry ("4 photos").
- Lazy-load; the timeline is long.
- [ ] Photos open full screen on phone; swipe works.

### D5. Completion report card
Fine as is; just swap the "Open" pill for the secondary button (consistency with C5).

---

## Part E — My colours (`/account/colours`)

### E1. The "code" is wrong
Every entry shows `CODE 6c15e22d` — that is a truncated internal ID, not a paint code. Customers want brand + product (e.g. "Dulux Ironstone"). Show `brand · product name · finish` where available and hide the code line when there is no real manufacturer code. ⚑ Confirm the colour record has a brand/finish field; if not, stop and report (do not expose the UUID).

### E2. Group by colour, not by surface
Ironstone appears 17 times for one property. Flip the grouping: one card per colour, listing the surfaces under it, with areas collapsed:
> **Ironstone** — Dulux, low sheen
> Weatherboards, gutters, downpipes, windows, garage door · all four elevations · 2 coats
Keep a "By area" toggle for people who want the old view. ⚑ Default view: by colour.

### E3. Swatches
Every swatch is the same grey. Use the colour's hex when known; when unknown, show the first letter of the colour name on surface-2 so it doesn't look broken.

### E4. Actions on top, per property
"Download as PDF" and "Need touch-up paint?" are at the very bottom after hundreds of rows. Move them into a sticky action row under each property heading. "Need touch-up paint?" ⚑ what does it do today — open Messages with a prefilled line? If so, prefill "Hi, I'd like touch-up paint for {address} — {colour list}".

### E5. Collapse properties
Each property section collapses to its heading + colour count. First (most recent) expanded by default.

### E6. The "stays on file for good" line
Appears per property plus in the intro. Keep it once, in the intro. Keep "Applied by 17 Sep 2026" per property but format the date like everywhere else (not ISO).

---

## Part F — Invoicing (`/account/money`)

### F1. Rename
Customers don't invoice — they pay. ⚑ Default: nav label and page title "Payments". Route can stay `/money`.

### F2. Per-project summary is inconsistent
First project shows a total ($7,886.11) and GST; the others just say "Invoices for this project". Every project card gets the same three numbers:
- **Total** $7,886.11 inc GST
- **Paid** $7,886.11
- **Remaining** $0.00 — or "Nothing owing" when zero
"ON TRACK" means nothing to a customer when everything is paid. Chip logic: `Nothing owing` (ok) / `Due {date}` (warn) / `Overdue` (danger).
- [ ] Every project card shows total, paid, remaining.

### F3. Collapse the receipt into the invoice row
Each invoice renders a card, a full-width "View invoice & PDF" button, then a separate receipt line with its own "Download PDF". Six taps' worth of UI for one paid invoice. New row:
> INV-0023 · Payment request · 25 Aug
> **$1,971.53** · Paid 25 Aug
> [Invoice PDF] [Receipt PDF]  ← two small secondary buttons, side by side
- [ ] A paid invoice is one row with two PDF buttons; no duplicated amount.

### F4. Unpaid state
Nothing in the test data is unpaid, so check the unpaid row exists and that it has a primary "Pay now" button and the due date. If payment isn't wired for customers yet, stop and report — don't build a dead button.

### F5. Footer line
Keep the "question about an invoice? ring us" line; body font, not mono.

---

## Part G — Messages

### G1. Hide empty threads
Six of eight threads say "No messages yet". Show only threads with messages in the list; put a single "Start a conversation about…" dropdown (address picker) at the top for the rest.

### G2. Unread vs count
The "2" badge is the message count, not unread. Make it unread only, cyan, and hide when zero. Bold the preview line when unread.

### G3. Thread screen
- Composer sticks to the bottom on mobile (above the bottom nav); the thread scrolls behind it.
- "Ask the assistant" becomes a secondary button in the body font; "Open the estimate" becomes a chip in the thread header next to the address (with the job's status chip).
- Sender name + time on one meta line under each bubble, body font, `ink-3`.
- Staff bubbles get an avatar initial so Robyn / Felipe are distinguishable.
- [ ] Composer visible without scrolling on a 400×860 viewport with 20 messages in the thread.

### G4. One chat, not two
See B3 — with the floating widget hidden in the portal, Messages is the only entry point. ⚑ Confirm.

---

## Part H — Profile

- H1. Helper text under email in body font (B1).
- H2. "Notifications & alerts →" card: make the whole card the link (B4).
- H3. Add Sign out (B5).

---

## Order of work (one session each, roughly)
1. Part A tokens + B1 typography sweep + B2/B3 header/widget → commit, review on phone.
2. Home (C) + Project switcher (D1).
3. Invoicing (F) + Messages (G).
4. Colours (E) — last, it has the only ⚑ that could need data (E1).
5. Profile (H) and a final axe/Lighthouse pass.

## ⚑ decisions — locked defaults for the overnight run
Claude Code builds the default and never stops to ask. Tom can overturn any of these in the morning review.
| ⚑ | Default to build |
|---|---|
| A2 | Light only, no toggle. Dark tokens and dark-mode CSS deleted outright. |
| A4 | Use a dark-on-light logo if one exists in storage/`public/`; otherwise CSS-filter the current PNG and flag. |
| B3 | Hide the floating "Chat with us" widget on all `/account/*` routes. |
| C2 | Dedupe identical addresses; show once with a count badge. Do not merge or delete anything. |
| C4 | One button: "Get an estimate for another property". Keep "Add an address" only if it has a distinct, working destination — then relabel it "Add a property (no estimate yet)". |
| D2 | Show "Extra work · N approved · $X inc GST" from approved extras; drop "Not started" when N > 0. |
| E1 | Show brand/product/finish if the colour record has those fields; otherwise show product name only and hide the code line. Never render the UUID. |
| E2 | Default view "By colour", with a "By area" toggle. |
| E4 | If "Need touch-up paint?" opens Messages, prefill the line; if it does something else, leave it as is. |
| F1 | Rename nav label and page title to "Payments". Route stays `/money`. |
| F4 | If customer payment is not wired, show the due date and "Ring us to pay" instead of a dead "Pay now". |

## How this fits the end-to-end picture
The portal is the customer's one window on everything the rest of the platform produces: wizard sessions (Home estimate list), PC Command work orders (My project timeline, photos, QA, sign-off), the colour register captured at estimate/WO time (My colours), the invoicing module (Payments), and the messaging adapter (Messages). None of these changes add a new source of truth — they re-present existing records more clearly. The two places where the portal currently exposes an internal seam are the colour "code" (E1, a UUID leaking through) and the variations/extras mismatch (D2); both are worth fixing at the source so PC Command, the contractor portal and the customer portal all say the same thing.
