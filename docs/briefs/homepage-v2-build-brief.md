# Build brief — Paint Group marketing homepage (v2)

**Repo:** paint-group-platform (Next.js 16 App Router, TypeScript, Tailwind, Supabase)
**Route:** `/` on the marketing site, served first on the test subdomain (see §8)
**Status:** ready to build. Flagged decisions (⚑) are listed in §9 — build with the placeholders given, do not invent values.

---

## 0. Read-order (commit these before writing code, then confirm the file list back)

1. `docs/briefs/homepage-v2-build-brief.md` — this file
2. `design/reference/paint-group-homepage-v2-prototype.html` — the interactive prototype. It is the source of truth for layout, copy, spacing, interaction and the analytics event names. Where the Figma file and the prototype disagree, the prototype wins.
3. Figma "Paint Group — Website" → page **02 Homepage → frame "Homepage — Desktop v2"** (https://www.figma.com/design/IifElzVSD7z5wK2Z55zXWq). Use it for the desktop composition and for the variable/token names on page **01 Foundations**.
4. `docs/briefs/website-experience-plan.md` — older-visitor rules (big type, phone number never hides, plain four-step section). Still binding.
5. `CLAUDE.md` — engineering standards. Missing reference = STOP and report.

**Motion scope:** the only animation on this page is the self-typing estimator (§4.2), the scripted progress story (§4.7), the promise explorer's state changes (§4.5) and the live-strip count-up (§4.8). The prototype matches this scope — port it, don't extend it. The page is built as the *painted* version: light sections, dark hero, dark trade lane, no transition effects between sections.

---

## 1. What this page is for

One job: get a visitor to type their address. Every section either makes that feel inevitable or proves a claim the copy makes. Residential and commercial are pushed **equally** — the address field is universal and the home/business choice sits inside it as chips, not as a page-level toggle.

Tone: English, plain, sentence case. No "expert painters Melbourne" language. Money is AUD inc. GST, formatted `$8,400 – $9,600` (en dash, comma thousands), in Martian Mono.

---

## 2. Structure and tokens

- **Fonts:** Switzer (Fontshare, weights 400/500/600) for everything; Martian Mono (400/500) only for money, references, and small data labels. Load via `next/font` with `display: swap`. Switzer is the production face; Geist appears in Figma only because Switzer isn't in Figma's library.
- **Tokens:** use the Figma variable names as Tailwind theme keys — `ink #0A0B0D`, `graphite #12161A`, `raised #171C21`, `line #242B32`, `text #EDF0F2`, `muted #8C959D`, `cyan #3BD8E9`, `on-cyan #03272D`, `paint #2FB9CB`, `amber #E0A83C`, `emerald #2FA46B`, `clay #B3574A`, `paper #F7F7F5`, `warm #EEECE6`, `tink #0A0B0D`, `tmut #5B646C`, `lline #DAD6CE`. Spacing/radius tokens as in the prototype's `:root`.
- **Components:** one file per section under `app/(marketing)/_sections/`, one shared `AddressField` component (used in hero and closing CTA), `Button`, `Chip`, `JobCard`, `PromiseExplorer`, `ProgressStory`, `Faq`. No section imports another section.
- **Mobile:** sticky bottom call bar (`Call us` / `See my price`) on <960px, exactly as the prototype. Body gets bottom padding so nothing hides behind it.
- **Reduced motion:** every animation in this brief has a static end state. `prefers-reduced-motion: reduce` shows the end state immediately.

---

## 3. Section order

1. Nav
2. Hero (dark) — with the self-typing estimator
3. How it works (warm)
4. Real jobs, real prices (paper)
5. Our promise — explorer (paper)
6. How you're kept informed — **scripted progress animation** (warm)
7. Live strip (paper)
8. Who'll be painting (warm)
9. For business — trade lane (dark)
10. Reviews (paper)
11. FAQ (warm)
12. Closing CTA (cyan)
13. Footer (dark)

Copy for every section is in the prototype; do not rewrite it. Where the prototype has `[square-bracket placeholders]` keep them as visible placeholders until the ⚑ in §9 is resolved.

---

## 4. Section specs and acceptance criteria

### 4.1 Nav
Sticky, translucent ink with blur. Logo, four links (≥960px only; `Real jobs, real prices` → `/work`), phone number as `tel:` link in Martian Mono, `See my price` cyan pill linking to `#top`.
- AC: phone number visible at every breakpoint (in nav on desktop, in the call bar on mobile).

### 4.2 Hero + self-typing estimator
Dark section, full viewport height, the taped-off copy block from the prototype (border only — no tape graphics, no peel). Kicker line, H1 `Transforming spaces.<br>Redefining painting.`, lead copy, `AddressField`, the ghost result line, suggestion dropdown, `This is` chips, the `Rather talk to a person?` line.

**The estimator runs itself** (`ghostRun` in the prototype, port faithfully):
- 900ms after mount, the field types an address character by character (38–78ms per char, jittered), the matching chip lights, then a result line fades in beside the field: address → price range (mono, cyan) → time label. Holds 3.2s, fades, next example. Loops.
- Examples, in this order, alternating home/business: `12 Elm Street, Northcote · home · $8,400 – $9,600 · 9 min to a range`, `4/22 High Street, Northcote · business · $3,100 – $3,600 · 6 min · vacate paint`, `9 Clarke Street, Thornbury · home · $14,200 – $15,800 · 11 min · exterior`, `31 Separation St, Northcote · business · $1,900 – $2,300 · 5 min · touch-up`. ⚑9.1 — replace with real anonymised jobs when supplied.
- **Stops the instant the visitor touches it**: focus, pointerdown or tap on a chip clears the field, hides the result, resets chips to `My home`, fires `ghost_stopped`, and never restarts in that session.
- While it types, the field has a soft cyan halo (`.field.typing`); the placeholder text is not shown.
- Real typing: after 3 characters, show three suggestions built from the input (prototype logic is a stub — wire to the platform's address lookup, same one the wizard uses). Selecting one fires `address_selected`.
- Submit (`See my price →`) fires `see_price` with `{where:'hero'|'bottom', mode:'home'|'biz'}` and routes to the wizard with the address and mode pre-filled.

AC:
- [ ] On a cold load with no interaction the field is mid-typing within 2s and shows a result within 6s.
- [ ] Tapping the field at any point in the loop leaves an empty, focused field with the caret in it and no ghost text anywhere.
- [ ] With reduced motion on, the field is empty and idle; the chips default to `My home`.
- [ ] Lighthouse: the ghost loop does not delay LCP (H1 is the LCP element; the loop starts after first paint).
- [ ] The `This is` chip state is passed to the wizard as `mode`.

### 4.3 How it works
Four white cards on warm: `See your price` / `We confirm it with you` / `Pick your dates` / `Sign off, then pay`, mono step numbers in `paint`, copy verbatim from the prototype. Below: `Rather talk to a person first? Call 1300 000 000 · Mon–Fri, 8am–5pm`.
- AC: at 375px the four cards stack; the phone line wraps without breaking the number.

### 4.4 Real jobs, real prices — cards, backend, and project pages
Three `JobCard`s on the homepage, driven by data Tom enters in the backend, each linking to a project page built from one fixed template. This is the one section with its own data model; it is built in §4.4a → §4.4c order and the homepage cards read from it from day one (seeded with placeholders).

**Card:** finished photo (4:3), job type, days on site, `SUBURB · COMPLETED MON YYYY`, price range in mono, one-line scope, `View this job →` (ink pill). Header copy from prototype; `All jobs →` links to `/work`. Card click fires `job_card` with the slug. The `Get a price like this →` action moves to the project page (§4.4c).

#### 4.4a Data model — `showcase_jobs`
One table, RLS: public `select` where `published = true`; write only for `owner`/`admin` roles via a zod'd server action (no client writes — repo standard).

| column | type | notes |
|---|---|---|
| id, created_at, updated_at | uuid / timestamptz | |
| slug | text unique | from title + suburb, editable, immutable after publish |
| title | text | e.g. `Exterior weatherboard` |
| job_type | enum `interior \| exterior \| commercial \| heritage \| body_corporate` | drives the wizard `scope` pre-fill |
| property_type | enum `home \| business` | which chip the wizard pre-selects |
| suburb | text | |
| completed_on | date | rendered `MON YYYY` |
| days_on_site | int | |
| price_low_cents, price_high_cents | int | AUD inc. GST; validate low ≤ high; rendered `$8,400 – $9,600` |
| scope_line | text ≤ 90 chars | the one-liner on the card |
| summary | text | 2–4 sentences, project page intro |
| what_we_did | jsonb `[{area, work}]` | ordered rows, e.g. `Living room — walls, ceiling, trim, 2 coats` |
| colours | jsonb `[{surface, brand, product, colour}]` | optional |
| condition_notes | text | what the property was like before (optional) |
| hero_media_id | uuid → media | the card/hero photo |
| gallery | jsonb `[{media_id, caption, kind: before\|during\|after}]` | ordered |
| estimate_id | uuid → estimates, nullable | when set, the wizard pre-fill uses the real scope tree; otherwise `job_type` only |
| review_quote, review_name | text, nullable | optional customer line, first name + suburb only |
| featured_rank | int nullable | the three lowest non-null ranks appear on the homepage |
| published | bool default false | |

Media uses the platform's existing storage adapter (Site Capture brief) — do not introduce a second upload path. Public URLs are signed-or-public per that adapter's rules for marketing media; photos are resized to 1600px and 800px variants on upload. ⚑9.11 — marketing photos must carry consent from the media library's consent scope; if Site Capture isn't merged yet, store `consent_confirmed: bool` on the row and block publish while false.

#### 4.4b Backend — Settings → Showcase jobs
Route: `/settings/showcase` (staff shell, owner/admin only). List view: table of all jobs with thumbnail, title, suburb, price range, published pill, featured rank, and `+ New job`. Row click → editor.

Editor is **one form in the exact order the public page renders**, so what Tom fills in top-to-bottom is what a visitor reads top-to-bottom: hero photo → title, job type, property type, suburb → completed on, days on site → price range → scope line → summary → what we did (repeatable rows, drag to reorder) → gallery (multi-upload, caption, before/during/after, drag to reorder) → colours (repeatable) → condition notes → customer line → link to estimate (search by estimate # or address) → featured rank → publish toggle.
- Live preview pane on desktop (≥1200px) rendering the real `ProjectPage` component with the form's current state; on smaller screens a `Preview` button opens it in a sheet.
- Validation messages are plain English inline; publish is blocked with a checklist (`Needs a hero photo`, `Needs a price range`, `Photo consent not confirmed`).
- Featured rank: exactly three jobs may hold ranks 1–3; setting a fourth asks which one to replace.
- AC: [ ] Tom can create, photograph, price, preview and publish a job without touching SQL or code; [ ] unpublishing removes it from `/work`, the homepage and its slug returns 404; [ ] editing a published job is live within 60s (ISR revalidate on save); [ ] all writes go through one server action with zod; the `showcase_jobs` table has no client `insert/update` policy.

#### 4.4c Project pages — `/work` and `/work/[slug]`
**Not a freeform page builder.** Every project page is the same template, filled from the row above — that is what keeps them consistent and is what makes the backend editor equal to the page. ⚑9.12 if Tom wants per-page freedom later, it's a separate brief; the answer for now is "the format is the builder".

`/work` — all published jobs as `JobCard`s, filters by job type and property type (chips, same component as the hero), newest completed first.

`/work/[slug]` template, in order (each block is its own component, all read-only):
1. **Hero** — hero photo full-bleed, over it: title, `SUBURB · COMPLETED MON YYYY · N DAYS ON SITE`, price range in mono, large.
2. **Summary** — 2–4 sentences.
3. **What we did** — the `what_we_did` rows as a two-column list (area / work).
4. **Gallery** — before/during/after photos in a masonry grid with the kind as a small tag; tap opens a lightbox with captions and keyboard nav.
5. **Colours** — swatch rows (brand, product, colour name) if present. Swatch colour comes from a small brand colour lookup table; unknown colours render as a neutral chip.
6. **Condition** — condition notes if present.
7. **What the customer said** — the optional quote.
8. **Get a price like this** — a dark panel: `A job like this in your home or business?` + `AddressField` (mode pre-set from `property_type`) → wizard with `scope` from `job_type` and, if `estimate_id` is set, the scope tree cloned from that estimate as the draft. Fires `job_get_price` with the slug.
9. **More jobs** — three other published jobs, same job type first.
- Metadata: title `“{title} in {suburb} — $8,400 – $9,600 | Paint Group”`, OG image = hero photo, `Article` + `Product`-free JSON-LD (no offers markup — prices are ranges, not offers).
- AC: [ ] every published job renders the same nine blocks in the same order with blocks 5–7 omitted cleanly when empty; [ ] the preview pane in §4.4b and the public page use the same component; [ ] `/work/[slug]` is statically generated with ISR; [ ] lightbox is keyboard-operable; [ ] `job_get_price` lands in the wizard with address, mode and scope pre-filled; [ ] the three featured jobs on the homepage are the three lowest `featured_rank` and nothing else.
- Photos: until Site Capture ships, upload directly in the editor via the adapter; the three launch jobs come from ⚑9.2.

### 4.5 Our promise — explorer
Left: four selectable rows (`role=tab`), right: dark panel (`role=tabpanel`) with the artefact for the selected promise. Port the four panels from the prototype's `P[]` array:
0. **No surprises on the invoice** — variation card (`Variation #2`, `+ $486`, `Approve $486` / `Ask a question`). Approving flips the pill to `Approved`, disables the button, shows the toast copy from the prototype.
1. **A price a person signs off with you** — the three-row range history ending `Confirm my price — book a call`.
2. **You sign off before you pay** — walkthrough list with one flagged item and a disabled `Sign off (1 item open)`.
3. **2-year warranty, $20M insured** — document list.
- Keyboard: arrow keys move between rows; panel content is announced.
- AC: [ ] default row is 0; [ ] each row fires `promise_{n}`; [ ] no panel mentions remote or absent sign-off (⚑ ruling: never advertised).

### 4.6 (removed — folded into 4.7)

### 4.7 How you're kept informed — scripted progress animation
A 22-second, self-playing story of one job as the customer experiences it on their phone — the page's "wow" moment. The prototype has a faithful reference build (`playStory`, `BEATS[]`); port its timings and states. It plays once when 50% in view, then shows a `↻ Replay` control. No other interaction.

**Layout:** warm section. Left column (desktop) / top (mobile): heading `Watch it happen from wherever you are.`, lead copy from the prototype, small `Live from a real job · demo data` label. Right: a phone frame (390×844 device outline, ink body, rounded 44px) showing the portal's Progress view for `12 Elm Street, Northcote · Interior · 4 rooms + hallway`.

**The script** (times from play start; every beat has a caption that appears in the left column in sync, big type, one line):

| t | On the phone | Caption (left) |
|---|---|---|
| 0.0s | Portal loads: header, `Day 1 of 5`, progress 0%, five areas all `To do`, empty photo strip. | *Monday, 7:31am — Felipe's on site.* |
| 2.0s | Notification banner slides in from top: `Felipe M. · Furniture moved, floors covered. Starting the living room.` Progress bar ticks to 8%. | *You get a message before the first brush touches a wall.* |
| 5.0s | Two photos slide into the strip (`Prep · floors covered`, `Living room · masked up`). Living room row flips `To do → Prepped` (amber). | *Photos from the site, every day.* |
| 8.0s | Day counter rolls `Day 1 → Day 3`. Living room flips `Prepped → Done` (emerald, tick animates in). Hallway flips to `Prepped`. Progress 48%. | *Every area ticked off as it's finished — no guessing.* |
| 11.0s | Today's update card types itself: `Living room finished and looking great. Hallway has its first coat; second coat first thing tomorrow. Back on site at 7:30.` | *An update in plain words at the end of each day.* |
| 14.5s | A variation card slides up: `Small patch of rot behind the fascia · + $486 · Approve / Ask a question`. The `Approve` button presses itself; pill flips to `Approved`. | *Anything extra is priced and approved by you before it starts.* |
| 17.5s | Day counter → `Day 5`. Remaining areas flip to `Done` in sequence (0.3s apart). Progress 100%. Banner: `Walkthrough booked · Fri 3:30pm, with you on site.` | *Then you walk it with us, room by room.* |
| 20.0s | Sign-off screen: `Signed off · 12 Elm Street` with a hand-drawn signature path animating, then `Final invoice · $9,180 inc. GST · due now`. | *You sign off. Then you pay.* |
| 22.0s | Hold. Replay control fades in. | *(caption stays)* |

**Rules for the animation:**
- Built with Framer Motion (already a dependency) as a single state machine driven by one timeline — not chained `setTimeout`s. Pausing on tab-blur and resuming is required.
- Everything shown must be a real portal component or a faithful visual copy of one — this is a promise of what they'll get. If the portal's Progress view changes, this section changes with it (note in the portal brief).
- Nothing in the script mentions signing off remotely, ratings, or start-date availability. The painter is named `Felipe M.` with specialty only (⚑9.3 for who actually appears).
- Captions are the accessible text: the phone frame is `aria-hidden`; the caption list is rendered in full for screen readers and reduced motion.
- Reduced motion: show the final frame (Day 5, all done, signed off) with the eight captions listed underneath.

AC:
- [ ] Plays once on entering view, never auto-replays; `↻ Replay` restarts from 0.
- [ ] Total runtime 22s ± 0.5s; captions and phone beats never drift by more than 100ms (assert with a timeline test, not by eye).
- [ ] 60fps on an iPhone 12 in Safari; no layout shift in the left column when captions change (fixed caption height).
- [ ] Fires `progress_story_start`, `progress_story_complete`, `progress_story_replay`.
- [ ] Tom's 90-second walkthrough: he watches it once on his phone and says the word.

### 4.8 Live strip
Pulse dot + `Live from the Paint Group platform · updated 2 min ago`, four tiles: estimates this week (38), jobs on site right now (6, with suburbs), average time to a price (9 min), prices honoured as signed off (100%). Count-up on enter (900ms, ease-out cubic).
- Numbers are **static constants in one config file** for launch (`marketing/liveStats.ts`) with a clear comment. ⚑9.4 sets when they go live; when they do, they are read server-side and cached 2 minutes — never computed client-side.
- **No start-date tile.** (Ruled: future feature.)
- AC: [ ] tiles read from the config; [ ] "updated 2 min ago" is literal text for launch, not a computed timestamp.

### 4.9 Who'll be painting
Heading, the trusted-network paragraph (verbatim), three painter cards (photo, name, specialty, `with Paint Group since YYYY` — **no ratings, no job counts**), and the four statements starting `Your expectations are documented for your painter before day one…`.
- Only painters in ⚑9.3 appear. Until then, the three cards render with the visible placeholder.

### 4.10 For business — trade lane
Dark section. Left: the portfolio table (`[Agency name] · 11 properties`, three property rows with PO refs and stage). Right: heading `Every property. One login. No chasing.`, lead, two buttons: `Book a 15-minute walkthrough` (cyan) → ⚑9.5 destination; `Open a trade account` (ghost) → `/trade/signup` (exists in the portal brief; leave as `#` with `data-todo` if not yet routed).
- The faint cyan mist background from the prototype (`.sweeps`) is fine here — it's static CSS.
- AC: [ ] no real client name until ⚑9.5; [ ] both buttons fire `trade_walkthrough` / `trade_account`.

### 4.11 Reviews
Three white cards, five amber stars, review text, `Name · suburb · job type`. ⚑9.6 supplies the three. Render placeholders visibly until then.

### 4.12 FAQ
Eight `<details>` exactly as the prototype (questions and answers verbatim — they've been through the pricing/sign-off rulings). Also emit `FAQPage` JSON-LD from the same source array.
- AC: [ ] one open at a time is **not** enforced (people compare answers); [ ] JSON-LD validates in Google's rich-results test.

### 4.13 Closing CTA
Cyan section, `See what it costs to paint your home or business. Now.`, second `AddressField` (ink), `or call 1300 000 000 — a real person, Mon–Fri 8am–5pm`. Fires `see_price` with `where:'bottom'`.

### 4.14 Footer
As prototype.

---

## 5. Analytics — ship wired, from day one

- Every element with `data-ev` in the prototype fires the same event name. Full list: `nav_cta, address_typed, address_selected, see_price, mode_home, mode_business, ghost_stopped, job_card, promise_0..3, progress_story_start, progress_story_complete, progress_story_replay, painter_card, trade_walkthrough, trade_account, faq_open (with question index), call_tap (any tel: link, with location)`.
- One `track(name, props)` helper in `lib/analytics.ts`. Provider: **Microsoft Clarity** (free; click maps, scroll maps, recordings) via its script tag, plus the same events to the platform's own `events` table so the CRM lead-source attribution has them later. ⚑9.7 if Tom prefers PostHog.
- Clarity is loaded after consent per the existing cookie banner; the platform events table needs no consent (first-party, no PII beyond what the visitor typed into the address field, which is only sent on `see_price`).
- AC: [ ] every event above is visible in Clarity's custom-tags view within 5 minutes of a test session; [ ] `see_price` carries `{where, mode}`; [ ] no event includes the typed address except `see_price`.

---

## 6. Performance and quality floor

- LCP < 2.0s on 4G for the hero H1; CLS < 0.05; INP < 200ms. The ghost estimator and the progress story must not regress these — measure with and without them.
- All images via `next/image` with explicit sizes; job photos ≤ 180KB each at 1200px wide.
- Visible focus on every control; the promise explorer and FAQ are fully keyboard-operable; colour contrast on cyan uses `on-cyan` text only.
- No `any`, no TODOs without a `data-todo`/⚑ reference, unit tests for the ghost loop state machine and the progress-story timeline (extract both to `lib/marketing/` — repo standard, vitest includes `lib/**`).
- e2e (Playwright) as an anonymous visitor on mobile viewport: load → ghost typing visible → tap field → field empty → type address → select suggestion → tap See my price → lands in wizard with address and mode pre-filled. This is the walking skeleton; it runs before any polish.

---

## 6b. Session order (one Claude Code session each; confirm the file list back before each)

1. **Walking skeleton** — route, tokens, fonts, nav, hero with a static field, footer; the §6 e2e passing against a stub wizard link.
2. **Showcase data** — `showcase_jobs` migration (Tom pastes the SQL between gate runs), RLS, zod server action, seed three placeholder rows.
3. **Showcase backend** — `/settings/showcase` list + editor + live preview.
4. **Project pages** — `/work`, `/work/[slug]`, `ProjectPage` component shared with the preview.
5. **Homepage sections** — How it works, Real jobs (reading from the table), Promise explorer, Live strip, Who'll be painting, Trade lane, Reviews, FAQ, closing CTA.
6. **Motion** — self-typing estimator, progress story, count-ups, reduced-motion fallbacks, timeline tests.
7. **Analytics + subdomain** — `track()`, Clarity, events table, `new.paintgroup.com.au` with noindex, e2e on the deployed subdomain.

## 7. Definition of done

1. All 13 sections render on desktop and 375px with prototype copy.
2. Ghost estimator, promise explorer, progress story and FAQ behave per their ACs, with reduced-motion fallbacks.
2b. Tom has published one real showcase job end-to-end from `/settings/showcase` and opened it at `/work/[slug]` on his phone.
3. Analytics events verified in Clarity and the events table.
4. e2e in §6 green on the test subdomain.
5. Placeholders for every open ⚑ are visible and greppable (`data-todo="9.x"`), none silently filled.
6. Tom's 90-second walkthrough on his phone: hero, one job card, the progress story, the FAQ. Approval = launch on the subdomain.

---

## 8. Test deployment — subdomain, not a second domain

- Deploy to `new.paintgroup.com.au` (Vercel project alias). `robots: noindex, nofollow` on every page of the new site while it's on the subdomain, plus a `X-Robots-Tag` header, so Google never sees two Paint Group sites. The old WordPress site stays as-is on the apex.
- Send paid and social traffic to the subdomain; compare the same five numbers on both sites for the test period: visitors, `address_typed` (old site: contact-form starts), `see_price` (old: form submits), estimates saved, `call_tap`.
- Flip: when the new site wins on estimates started, point the apex at the new project, remove noindex, 301 the 36 suburb-page URLs to their new equivalents (⚑9.8 — those pages aren't in this brief; a redirect map is required before the flip).

---

## 9. Flagged decisions — Tom, not the code

| # | Decision | Placeholder until decided |
|---|---|---|
| 9.1 | Four real, anonymised jobs for the self-typing estimator (address can be street-only, range, minutes-to-range). | The four examples in §4.2 |
| 9.2 | Three completed jobs for the job cards: photo, type, suburb, month, days on site, **real price range inc. GST**, one-line scope. | Bracketed placeholders |
| 9.3 | Which painters have agreed to be named and photographed. Specialty + start year only; no ratings. | `[Painter n]` cards |
| 9.4 | When the live strip switches from config constants to real platform numbers (and which four numbers). | Constants in `liveStats.ts` |
| 9.5 | Trade lane: a real client happy to be named, or keep it generic (`A Northcote agency · 11 properties`). Destination for `Book a 15-minute walkthrough` (visit-booking module vs a calendar link). | Generic name, `#` |
| 9.6 | Three real Google reviews (permission obtained), ideally one each on price-as-quoted, daily updates, finish. | Bracketed placeholders |
| 9.7 | Analytics provider: Clarity (recommended, free) or PostHog. | Clarity |
| 9.8 | Redirect map for the 36 suburb pages before the domain flip; whether suburb pages are rebuilt in v2 or kept on WordPress temporarily. | Not built; flip blocked until decided |
| 9.9 | Legal read of the "No surprises on the invoice" and warranty wording on the promise explorer before launch on the apex (fine on the noindex subdomain). | Ship as written on subdomain |
| 9.10 | Phone number: `1300 000 000` is a placeholder throughout. | Placeholder |
| 9.11 | Photo consent for marketing use: rely on the Site Capture consent scope, or a per-job `consent_confirmed` tick until it ships. | Per-job tick, publish blocked while false |
| 9.12 | Project pages are one fixed template, not a freeform builder. Confirm — or say what per-page freedom you actually need and it becomes a separate brief. | Fixed template |
| 9.13 | Whether a project page shows the customer's first name with the quote, or suburb only. | First name + suburb |

---

## 10. Explicitly out of scope

Any scroll-driven or decorative motion (roller, pour, spray, peel, cutting-in headline, drop-sheet reveals, colour-swatch repaint, tape-under-prices, tightening-range panel). If a later motion sprint happens it is a separate brief; nothing in this build should anticipate it.
