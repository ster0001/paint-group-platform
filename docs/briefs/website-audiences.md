# Build brief — Session 8: Residential and commercial audiences

**Repo:** paint-group-platform · **Depends on:** homepage v2 Sessions 1–7 live on the subdomain; `showcase_jobs` published. One session, possibly two (content editor is the second).

---

## 0. Read-order (commit, read, confirm the list back before code)

1. This brief — `docs/briefs/website-audiences.md`
2. `docs/briefs/claude-code-brief-homepage-v2.md` — every section this brief varies; §4.4 for `showcase_jobs`; §5 for events; §8 for the subdomain/noindex setup
3. `docs/briefs/wizard-progress-crm-buckets.md` §2.1 — `mode` and `entry_source` on `wizard_sessions`
4. `app/(marketing)/` as built — section components and `AddressField`
5. `CLAUDE.md`. Missing reference = STOP and report.

---

## 1. Rulings (Tom, 6 Sep 2026)

- One brand. The commercial site is **Paint Group**, same logo, same phone, same Google Business Profile. Not "Paint Group Commercial".
- Two domains, one codebase. `paintgroup.com.au` = homes. The commercial domain (⚑ D1 for the exact hostname) = businesses.
- The property chip is **unlocked** on the commercial domain. A homeowner who lands there can pick "My home" and continue — the wizard opens in home mode; they are not bounced.
- Commercial jobs and reviews exist in volume; the business site launches with three real commercial job cards, no padding.
- The business copy set (FAQ, steps, promise, hero) is a **draft to be worked through after the build** — ship it in the editor, not in code, so Tom can change it without a deploy.

---

## 2. Audience resolution

`audience ∈ {home, business}`, decided per request in `middleware.ts`, never from a cookie:

1. Hostname matches the commercial domain → `business`.
2. Path starts with `/business` on the residential domain → `business`, **and** 301 to the same path on the commercial domain (so every business URL has one canonical home).
3. Otherwise → `home`.

Expose via a request header the layout reads once and provides through `useAudience()`. No client-side switching; the nav's **For business → / For homes →** links are plain `<a>` to the other domain's homepage.

AC: [ ] `curl` each domain root and `/business` and see the correct audience header and redirect; [ ] no cookie is set or read for audience.

---

## 3. Content model — `site_content`

| column | type | notes |
|---|---|---|
| id | uuid | |
| audience | enum `home \| business` | |
| section | text | `hero \| estimator_examples \| how_it_works \| promise \| story \| painters \| trade \| faq \| cta \| meta` |
| key | text | e.g. `kicker`, `h1`, `lead`, `step_1_title`, `faq_3_q`, `faq_3_a`, `title_tag`, `meta_description` |
| value | text | markdown allowed in `*_a` and `lead` keys only |
| sort | int | for repeatable keys |
| updated_by, updated_at | | |

Unique on `(audience, section, key, sort)`. RLS: public `select`; writes owner/admin via one zod'd server action.

- **Seed** the `home` set from the copy as built (extract it — no copy stays hard-coded after this session), and the `business` set from §6 below. Both seeds are migrations so environments match.
- Sections read content through one `getContent(audience, section)` server helper with ISR revalidate on save (same pattern as showcase jobs).
- **Settings → Website** editor: two tabs (Homes / Businesses), sections in page order, each key as a labelled field, live preview of the real homepage for that audience. Markdown keys get a plain textarea; no rich-text editor.

AC: [ ] every string on both homepages comes from `site_content` or `showcase_jobs` or reviews; grep for the H1 text in `app/` returns nothing; [ ] editing a business FAQ shows on the commercial domain within 60s; [ ] the seed migration is idempotent.

---

## 4. What varies per section

| Section | `home` | `business` |
|---|---|---|
| Nav | links as built; **For business →** to commercial domain | links: Commercial jobs · How it works · For agents & FMs · Reviews; **For homes →** to residential domain |
| Hero | as built | kicker/H1/lead from content; chip **defaults to business, unlocked** |
| Self-typing estimator | examples with `mode = home` only | examples with `mode = business` only |
| How it works | as built | four business steps from content |
| Real jobs, real prices | `property_type = home`, by `featured_rank` | `property_type = business` first by `featured_rank`, then newest business; **never** fills with home jobs while ≥3 business jobs are published |
| Our promise | four items from content | four items from content (different set) |
| Progress story | 12 Elm St, home | 4/22 High St vacate paint, with an extra beat "Sent to your PM · PO 4471 on every photo" at 13.0s (captions from content; beat timing in code) |
| Live strip | as built | as built (same numbers) |
| Who'll be painting | as built | same painters; intro copy from content |
| Trade lane | as built | promoted: sits directly after the jobs, full-width table |
| Reviews | Google reviews tagged `home` or untagged | tagged `business`; if fewer than three, the three best untagged with the header "From homeowners and businesses" |
| FAQ | eight `home` entries | eight `business` entries |
| Closing CTA | as built | copy from content; chip default business |
| Meta | title/description from content; `LocalBusiness` schema | title/description from content; same `LocalBusiness` `@id` (one business), `serviceType` differs; separate sitemap |

Wizard handoff: `see_price` from either domain routes to the residential domain's `/estimate` with `mode` and `entry_source` (`commercial_home_hero`, `commercial_home_cta`, `job_page:<slug>`). The wizard itself is not duplicated. ⚑ D2 if the commercial domain should host its own `/estimate` URL for brand continuity (cosmetic; adds a domain to the auth cookie scope).

---

## 5. Reviews tagging

- `google_reviews` (or the import table as built) gets `audience enum home \| business \| null`.
- Import guesses from text (agency, office, shop, tenant, strata, body corporate, warehouse → `business`) and writes the guess to `audience_suggested`; Tom confirms in Settings → Reviews with one tap per review. Only confirmed tags drive the filter.

---

## 6. Business copy seed (draft — Tom edits in the editor after build)

- **Kicker:** Melbourne · agencies, facilities, strata and businesses · a range today, approvals by link
- **H1:** Paint your properties without the chasing.
- **Lead:** Type the address — a vacate, a shopfront, an office, a common area or a whole portfolio. A real price range in about ten minutes, your reference on everything, approvals by link. One invoice run.
- **Steps:** Send the job in plain English → A range straight back, confirmed by a person → Approve by link, PO on every document → One invoice, one login for every property
- **Promise:** No surprises on the invoice · Approvals by link, with a paper trail · Your reference on every photo, report and invoice · 2-year warranty, $20M insured, certificates in the portal
- **FAQ (eight):** Can you work after hours or weekends? · Do you handle multiple sites under one account? · Can you put our PO number on everything? · How fast can you turn a vacate paint around? · Who approves variations on our side? · Can we get one invoice for the month? · Are you insured for commercial sites and do you provide certificates? · Do you do body-corporate and strata common areas?
- **CTA:** See what it costs to paint your property. Now.
- **Meta title:** Commercial painters Melbourne — see your price today | Paint Group

Answers for the FAQ: draft from the Paint Group brain where it has them; where it doesn't, write the answer as a visible `[Tom to confirm]` placeholder in the seed. Do not invent policy.

---

## 7. Domains, SEO and launch

- Vercel: add the commercial domain to the same project; middleware does the routing. Both stay `noindex` until the apex flip; the commercial domain flips at the same time.
- Sitemaps per domain, built from audience: residential domain lists home pages + home project pages; commercial lists business pages + business project pages. Project pages 301 to the domain matching their `property_type`.
- `LocalBusiness` schema on both with the same `@id` (one business), different `serviceType`, both listing the same phone and address.
- Canonicals are self-referential per domain; no page is served on both.
- Analytics: `track()` adds `audience` to every event. Clarity gets one project per domain (⚑ D3 if one shared project is preferred).

AC: [ ] Lighthouse on the commercial homepage matches the residential floor (§6 of the homepage brief); [ ] no URL returns 200 on both domains; [ ] both sitemaps validate; [ ] `see_price` from the commercial domain lands in the wizard with `mode=business` and `entry_source=commercial_home_hero`.

---

## 8. Tests and done

- Unit: audience resolution (hostname × path), job ranking per audience with 0/2/3/5 business jobs published, review fallback rule.
- e2e (mobile viewport):
  1. Commercial domain root → business H1, business chip pre-selected, three business job cards, business FAQ visible.
  2. Same page → tap "My home" chip → type address → See my price → wizard opens with `mode=home` (unlocked path).
  3. Residential domain `/business` → 301 to commercial root.
  4. Settings → Website → edit a business FAQ answer → visible on commercial domain within 60s.
- Done when: all ACs green; Tom opens both domains on his phone, switches between them via the nav links, and edits one business FAQ himself in the editor.

---

## 9. Flagged decisions

| # | Decision | Assumed |
|---|---|---|
| D1 | Exact commercial hostname (and whether `www` is canonical there). | Placeholder `COMMERCIAL_DOMAIN` env var |
| D2 | Host `/estimate` on the commercial domain too, or always hand off to the residential domain. | Hand off |
| D3 | One Clarity project per domain or one shared. | Per domain |
| D4 | Which three commercial jobs are featured first (set `featured_rank` for business in Settings → Showcase jobs — needs a per-audience rank; add `featured_rank_business` or a rank per audience). | Per-audience rank column |
| D5 | Business FAQ answers — work through in the editor after build. | Brain-sourced where available, `[Tom to confirm]` elsewhere |
