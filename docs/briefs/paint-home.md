# Build brief — Paint Home (painthome.com.au)

**Repo:** paint-group-platform · **Status:** ready to build. Flagged decisions (⚑) in §9 — build with the placeholders given, do not invent.

---

## 0. Read-order (commit, read in order, confirm the file list back before any code)

1. This brief — `docs/briefs/paint-home.md`
2. `design/reference/paint-home-homepage-prototype.html`, `paint-home-logo-dark.svg`, `paint-home-logo-light.svg` — the Paint Home homepage. Source of truth for copy, section order and interactions. Where it and the Paint Group prototype differ, this one wins for Paint Home.
3. `docs/briefs/website-audiences.md` (Session 8) — the `audience` middleware and `site_content` table this brief extends. **Do not build a second mechanism.**
4. `docs/briefs/claude-code-brief-homepage-v2.md` — section components, `showcase_jobs`, analytics, subdomain/noindex rules. Paint Home reuses every component.
5. `docs/briefs/wizard-progress-crm-buckets.md` — `wizard_sessions.entry_source` and buckets; Paint Home leads flow through the same buckets.
6. The current estimator wizard build (the C-series ledger `estimator-v2-progress.md` and `claude-code-brief-wizard-ui-refresh.md`) — Paint Home uses the wizard as built, residential interior and exterior branches only.
7. `CLAUDE.md`. Missing reference = STOP and report.

---

## 1a. Voice and look — binding for all Paint Home copy and UI

**Voice.** The tagline is *Your qualified local painters*, and everything is written to earn it: minimal, direct, confident. Short sentences. Say what happens, in order, without selling it. No jokes, no mateyness, no exclamation marks, no rhetorical questions in headings.

- Headings are statements: *How it works.* *Real jobs. Real prices.* *Who does the work.* *See your price today.*
- Use plain nouns: price, invoice, guarantee, walk-through, photos. Avoid Paint Group's system words (*portal, estimate builder, variation, work order, scope*) and avoid slang (*ring, bill, lock it in, turn up, pop in*).
- Lead with the customer's outcome, in one clause: *Your price appears on screen in about ten minutes.*
- Never claim anything Paint Group's copy doesn't — the promises are identical, only the register changes.
- **Paint Home stands on its own.** Paint Group appears in exactly four places and nowhere else: small print beside the nav logo (*powered by Paint Group*), one line under the reviews (*Powered by Paint Group · reviews on Google*), one sentence at the end of the *Who is Paint Home?* FAQ answer, and the footer legal block. No "the team behind", no "same crew", no origin story, no cross-link band, no Paint Group links in nav, hero or footer. Painters are *our painters*; the guarantee and insurance are *ours*.
- The prototype's copy is the reference register; match it for anything new.

**Look.** A separate palette from Paint Group, keyed to the logo. Tokens in `brand.ts` for `painthome`:

| token | value | use |
|---|---|---|
| `brand` | `#17F9F1` | logo cyan — accent only: nav mark, address-field border, selected chip, focus ring, small highlights. Never a full section. |
| `teal` / `teal-deep` | `#02ADB5` / `#0A8A90` | buttons, links, step numbers |
| `slate` / `slate-2` / `slate-3` / `slate-line` | `#2E3A3D` / `#3B484C` / `#48565A` / `#5A6A6E` | the dark surfaces (hero, nav, promise panel, phone frame, footer) — a deep grey-green, never Paint Group's black |
| `sage` / `sage-pale` | `#9DB4A6` / `#E4ECE6` | the "warm" sections (how it works, story, painters, FAQ), tags, placeholder photos |
| `blush` / `blush-deep` | `#E8CFC9` / `#C99A90` | one warm note: closing CTA background, review stars, rule markers. Keep it to those. |
| `stone` / `stone-2` / `stone-line` | `#F4F2EE` / `#EAE6DF` / `#D8D2C8` | the light sections and cards (`#FBFAF8` card fill) |
| text on dark / muted | `#F2F4F3` / `#B6C0BE` | |
| text on light / muted | `#22302F` / `#5F6E6B` | |
| states | amber `#D9A66B`, green `#6FA287`, clay `#B8766B` | softened versions of the platform states |

**Type.** Switzer only — Paint Home does not use Martian Mono anywhere. Small labels are Switzer 500 at 13px, sentence case, no tracking, no uppercase; prices and the phone number are Switzer 600 with `font-variant-numeric: tabular-nums`. The `mono` token for `painthome` aliases to the sans so shared components need no change.

Hero: slate with a slight warm-grey gradient, the copy block semi-transparent slate with a faint blush border. Closing CTA: blush with slate text and a teal button. Everything else maps onto the shared component tokens (`ink → slate`, `paper → stone`, `warm → sage-pale`, `cyan → teal`) so no layout code changes — only the token file per brand. Paint Group's palette is untouched.

## 1. What Paint Home is (plain English, binding)

Paint Home is a **second shopfront on the same business**. Same Supabase, same staff backend, same estimator wizard, same painters, same CRM, same invoicing. The only things that are Paint Home's own are the domain, the logo, the words on the homepage, and a `brand` tag on every lead so Tom can see which door a customer came through.

It is **not** a clone of the repo, a second Supabase project, a second deployment, or a second wizard. One codebase serves three audiences: `home` (paintgroup.com.au), `business` (commercial domain), `painthome` (painthome.com.au). If anything in this brief would require copying code into a parallel folder, stop — it belongs in the shared component with a brand switch.

Who it's for: homeowners with smaller jobs — apartments, units, townhouses, a few rooms, a single-storey exterior — who want to do the legwork themselves online and get to a confirmed price with as little human contact as possible.

What it sells: *price it yourself in ten minutes, one quick call to confirm, pick your dates, done. No salesperson in your lounge room.* Backed by the same reviews, painters, warranty and insurance as Paint Group — but presented as Paint Home's own, with a single small-print "powered by Paint Group" credit (see §1a).

---

## 2. Rulings carried over (do not reopen)

- A price is confirmed by a person before it's fixed. For Paint Home that person is on the **phone**, not on site — Paint Home only takes jobs in the phone-close tier (§5). The wizard never fixes a price by itself. ⚑ P1 asks Tom whether Paint Home may relax this; until answered, it stands.
- Customers are present for the sign-off walkthrough. Remote sign-off is not advertised.
- Painter cards show no ratings and no job counts.
- Reviews are Paint Group's Google reviews; the one-line credit *Powered by Paint Group · reviews on Google* sits under the cards. That credit is the honesty mechanism — the copy around them never says "these are Paint Group's reviews".
- Legal entity on the site: *Enlvn Pty Ltd trading as Paint Home*. Warranty and public liability are Paint Group's / Enlvn's — the site says so in the FAQ and the promise panel; the certificates in the portal are the same documents.

---

## 3. Brand resolution — extend Session 8, don't fork it

`audience` gains a third value: `painthome`.

1. Hostname `painthome.com.au` (and `www`) → `painthome`.
2. Everything else resolves exactly as Session 8 wrote it.

`useAudience()` returns `painthome`; components that already branch on `home | business` gain a `painthome` arm, which **defaults to the `home` arm** unless this brief says otherwise. That default is deliberate: Paint Home is Paint Group's residential experience with different words, not a different product.

- Brand assets: `brand.ts` maps audience → `{name, logoDark, logoLight, tagline, phone, legalLine, domain, primaryColour, secondaryColour}`. Paint Home logos are supplied: `design/reference/paint-home-logo-dark.svg` (for ink backgrounds) and `paint-home-logo-light.svg` (for paper/warm). Nav uses the dark SVG cropped to `viewBox="0 0 840 132"` (no tagline row); footer and OG image use the full mark. Colours per §1a. Tagline `Your qualified local painters` is the hero kicker. Keep the SVGs inline (they're vectors), never rasterised except for the OG image (1200×630, dark background).
- Nav, footer, metadata, `LocalBusiness` schema, OG image and favicon all read from `brand.ts`. **`LocalBusiness` for Paint Home is a separate `@id`** (different trading name and domain) with `parentOrganization` → Paint Group's `@id`. One business, two brands, Google can see the relationship.
- Cross-links: the only links to paintgroup.com.au are the two *powered by* credits. No nav or footer link. Oversized jobs reach Paint Group through the wizard handoff (§5), which says "the right team", not "Paint Group". ⚑ P3 (link from Paint Group's site to Paint Home) stands.

AC: [ ] `curl painthome.com.au` returns `x-audience: painthome`; [ ] no cookie involved; [ ] a `home` component with no `painthome` branch renders the home version, never an error or the business version.

---

## 4. Homepage — sections and what differs

Same 13-section component list as the Paint Group homepage. Copy comes from `site_content` under `audience = painthome`, seeded from the prototype (migration, idempotent). Differences from `home`:

| Section | Paint Home |
|---|---|
| Nav | Paint Home logo with small-print `powered by Paint Group`; links: Real jobs, real prices · How it works · Who'll be painting · Reviews. No "For business", no Paint Group link. |
| Hero | Kicker, H1 `Painting, priced online. / Done your way.`, lead and chips from the prototype. **Chips are `Inside` / `Outside`** (wizard `scope = interior | exterior`), not home/business. Line under the field: "Apartments, units, townhouses, one room or the whole place · Inside, outside, or one room at a time". |
| Self-typing estimator | Four examples, all homes, all phone-close sized (prototype `G[]`); ⚑ P4 for real anonymised Paint Home jobs. |
| How it works | Step 1 `Price it yourself`, step 2 `One quick call` ("no site visit for most Paint Home jobs"), steps 3–4 as home. |
| Real jobs, real prices | `showcase_jobs` where `property_type = home` **and** `price_high_cents ≤ phone-close threshold` (§5), by a per-audience `featured_rank_painthome`; falls back to newest matching. Never shows a commercial job. Copy from the prototype (*What it actually cost the neighbours*). |
| Our promise | Same four panels, Paint Home wording from the prototype; panel 2's artefact ends `Confirm my price — book a call`; panel 4 says *ours*, not Paint Group's. |
| Progress story | Same 22-second story, same `12 Elm St` job; caption 1 unchanged. No re-filming. |
| Live strip | Same numbers as `home` (they're Paint Group's platform numbers; the label already says so). |
| Who'll be painting | Same painters; *painting with us since YYYY*; intro from the prototype (*Our own painters, not whoever's free on an app*). |
| Trade lane | **Removed.** Nothing replaces it — the page goes straight from painters to reviews. |
| Reviews | Same Google reviews as `home`; lead *Straight from Google, from the people our painters have worked for*; small-print `Powered by Paint Group · reviews on Google` under the cards. |
| FAQ | The `home` eight plus two new at top: `Who is Paint Home?` (ends with the one sentence *Paint Home is powered by Paint Group*) and `My job's a big one. Still the right place?` (answer: put the address in anyway, we'll hand you to the right team — no Paint Group name). `FAQPage` JSON-LD from the same array. |
| Closing CTA | `See what it costs to paint your home. Now.` |
| Footer | Paint Home block with `Powered by Paint Group` and the Enlvn legal line; Services: Apartments & units · Interiors · Exteriors · Bigger jobs (⚑ P11 destination). No Paint Group column link. |

`track()` already carries `audience`; every event on painthome.com.au reports `audience: painthome`. New events: `scope_interior`, `scope_exterior`.

AC: [ ] no string on painthome.com.au contains "business", "commercial", "agent", "PO", "portfolio" or "trade" outside the big-job FAQ answer; [ ] "Paint Group" appears exactly four times on the homepage (nav small print, reviews credit, FAQ sentence, footer) — assert with a test; [ ] every price on the three cards is ≤ the phone-close threshold; [ ] Lighthouse matches the Paint Group floor.

---

## 5. The wizard on Paint Home — same wizard, two doors shut

Paint Home hands off to the **same** `/estimate` on the same deployment (hosted under painthome.com.au via the audience middleware, so the customer never sees a Paint Group URL mid-flow — ⚑ P5 if Tom prefers a handoff to login.paintgroup.com.au instead).

Entry: `see_price` from Paint Home → `/estimate?address=&scope=interior|exterior&brand=painthome&entry_source=painthome_home_hero|painthome_home_cta|job_page:<slug>`.

What's different when `brand = painthome`:

- **Property type is fixed to residential.** The property-type question (home / business / strata / …) is not shown; the session starts in the residential branch. No commercial pages, segments, questions or copy are reachable — assert with a route test, not by hiding buttons.
- **Scope is pre-selected** from the chip (`interior` or `exterior`) and shown as answered on page 1 — editable, but the customer never sees a "both" or "commercial" option on Paint Home. ⚑ P6 whether "both" is allowed on Paint Home (brief assumes no: two separate estimates, keeps jobs small).
- **Visit tier is phone-only.** At the price step, Paint Home uses the visit-policy function with `brand = painthome`: `self-serve/phone-first` → `Confirm my price — book a call`; `manual/visit` → a polite handoff: "This one's bigger than we can price from your phone — we'll have someone come and look" with a button that books a Paint Group site visit. The customer's answers are kept; nothing is re-asked. The handoff screen is where Paint Group is first named to the customer ("You'll hear from the Paint Group team, who look after our larger jobs") — that's honest and it's late enough. The threshold is the existing Settings value for the phone-close tier (⚑ P7 for a Paint Home-specific value; default = Paint Group's).
- Sarah Reid remains the named estimator throughout, introduced simply as *Sarah, who'll be checking your price* — no Paint Group mention in the wizard until the handoff screen.
- Everything else — pages, autosave, confidence, range widening, photos, defects, allowances, rate card, pricing engine — is untouched. No forked pages, no copied components. If a Paint Home change can't be expressed as a `brand` branch inside the existing page, stop and report.

Lead and account data:

- `wizard_sessions.brand` and `estimates.brand` (`paintgroup | painthome`, default `paintgroup`), set at session creation, carried to the lead, the estimate, the work order and the invoice. One migration, Tom pastes it between gate runs.
- Customer accounts are **shared**: an email that exists from Paint Group signs into Paint Home and sees all their jobs. The portal shows the brand on each job. ⚑ P8 whether the portal itself is re-skinned for Paint Home (brief assumes: portal shows Paint Home logo in the header when the job's brand is painthome, nothing else changes).
- Customer-facing comms (estimate emails, SMS, invoices, warranty PDF) read `brand.ts` for name/logo/sender; the invoice carries the Enlvn legal line in both cases. The messaging adapter gets a `brand` parameter, not a second template set — one set of templates with brand tokens.

AC: [ ] e2e from painthome.com.au: address → Inside → wizard shows no property-type page, no commercial option, scope pre-answered → price → `Confirm my price — book a call` → session, estimate and lead all carry `brand = painthome`; [ ] a Paint Home session that crosses the threshold lands on the handoff screen with its answers intact; [ ] a route test proves every commercial wizard route 404s or redirects when `brand = painthome`.

---

## 6. Staff side — one platform, a brand column

- Estimates list, CRM, PC Command, invoicing and the dashboard gain a `brand` pill (Paint Group / Paint Home) and a filter. No separate views.
- Dashboard "Where estimates go" and "Marketing" sections split by brand so the side-by-side test is readable in one place: visits, `address_typed`, `see_price`, estimates saved, calls requested, confirmed, booked — per brand.
- Settings → Showcase jobs gains `featured_rank_painthome` (per-audience rank, as Session 8 ⚑ D4 anticipated).
- Settings → Website gains a third tab, Paint Home.
- Settings → Brands (new, small): logo, phone, legal line, primary colour, domain per brand — the editable face of `brand.ts`. Changing the colour changes `--brand` everywhere.

---

## 7. Domains, SEO, launch and the side-by-side test

- Vercel: add `painthome.com.au` (+ `www` → apex) to the existing project. Middleware routes it. Until Tom flips, `noindex` like the other pre-launch hosts; the flip for Paint Home is independent of the Paint Group apex flip.
- Separate sitemap, robots, canonicals, OG image, favicon. Project pages for Paint Home-sized jobs can appear on both sites (same `showcase_jobs` row) only with **one canonical** — the Paint Group URL — so the two sites don't compete. ⚑ P9 if Tom wants Paint Home to own the apartment/unit pages instead.
- Analytics: Clarity project for Paint Home; the platform `events` table already carries `audience`.
- Test plan (Tom's step 6): both sites live, both with the wizard. Compare, per brand, the same five numbers as the subdomain test plus `calls_requested` and `confirmed`. Paint Home traffic comes from its own ads and social; nothing is redirected from Paint Group. Bugs found in Paint Home's wizard are fixed once, in the shared wizard, and both brands get the fix — that's the point of not forking.

---

## 8. Sessions (one Claude Code session each; confirm the file list before each)

1. **Brand plumbing** — `audience = painthome` in middleware, `brand.ts`, Settings → Brands, Vercel domain, noindex, nav/footer/meta/schema reading from the brand. Homepage renders the `home` content under the Paint Home brand (words still Paint Group's). e2e: domain → audience → wizard handoff with `brand=painthome`.
2. **Content** — `site_content` seed for `painthome` from the prototype; Settings → Website tab; the cross-link band component; reviews small-print; FAQ additions; `featured_rank_painthome` and job filtering.
3. **Wizard brand branch** — `brand` column migration; residential-only entry; scope pre-select; phone-only visit tier with the handoff screen; Sarah's intro line; route tests; the five-step e2e in §5.
4. **Comms and portal** — brand tokens in templates, invoice legal line, portal header logo per job brand, shared-account behaviour.
5. **Staff side** — brand pill and filters; dashboard split; Showcase/Website settings.
6. **Launch** — Clarity, sitemap/robots/canonicals, Tom's 90-second walkthrough on his phone (hero, Inside chip, a job card, the FAQ, the wizard to the call screen), remove noindex.

---

## 9. Flagged decisions — Tom

| # | Decision | Assumed until decided |
|---|---|---|
| P1 | "Self sign": may a Paint Home customer accept and book online with **no** call, inside the phone-close tier? This is a change to the standing ruling, not a Paint Home default. | No — one short call stays |
| P2 | ~~Logo~~ — supplied 21 Oct. Tagline *Your qualified local painters* is now the H1 (ruled 24 Oct). | Done |
| P3 | Link to Paint Home from paintgroup.com.au now, or only after the test proves it. | After |
| P4 | Four real anonymised Paint Home-sized jobs for the self-typing estimator; three for the job cards (≤ threshold). | Prototype examples |
| P5 | Wizard URL stays on painthome.com.au (recommended) or hands to login.paintgroup.com.au. | painthome.com.au |
| P6 | "Both inside and outside" allowed on Paint Home, or two estimates. | Two estimates |
| P7 | Phone-close threshold for Paint Home — same as Paint Group's Settings value, or its own. | Same |
| P8 | Portal re-skin for Paint Home jobs beyond the header logo. | Header logo only |
| P9 | Who owns apartment/unit project pages in search — Paint Group (canonical) or Paint Home. | Paint Group |
| P10 | Paint Home phone number: Paint Group's 1300, or a second number on the Twilio roster that tags the call `brand = painthome`. Whoever answers should say "Paint Home" when the call is tagged painthome — needs a line in the office script. | Same number for launch; tag at the CRM |
| P11 | Footer "Bigger jobs" link — to the wizard (which hands off itself) or to a short Paint Home page explaining the handoff. | The wizard |

---

## 10. Out of scope

A second repo, Supabase project or deployment; a Paint Home-only wizard; commercial anything on Paint Home; new motion; a third brand (the mechanism built here is what a third brand would reuse).
