# Paint Home — Session 1: brand plumbing (painthome.com.au as a third audience)

**Brief:** `docs/briefs/paint-home.md` §3, §8.1 (committed in this PR with the prototype and the two logo marks). Tom, 24 Oct 2026: "make sure it doesn't interrupt the current Paint Group site and is linked to the new site www.painthome.com.au; make it clean."

## What this is
Paint Home is a second shopfront on the same business — same Supabase, wizard, painters, CRM and invoicing. This PR is the plumbing only: the domain resolves to a third `audience`, one brand record drives everything that differs, and the homepage renders under the Paint Home brand with the homes site's words (Session 2 seeds Paint Home's own).

## Paint Group is untouched
- The resolver adds a branch keyed to Paint Home's hostnames and the `/painthome` path (which 404'd before). Every other host × path resolves exactly as Session 8 wrote it — pinned by the existing tests, which still pass unchanged.
- Paint Group's colour tokens, copy, logo and routes are not edited. The Paint Home palette is one CSS block scoped to `[data-brand="painthome"]`.
- On a Paint Group host, `/painthome…` 301s to painthome.com.au — one canonical home; the Paint Group site never answers for Paint Home.

## What changed
- `lib/marketing/audience.ts` — `AUDIENCES` gains `painthome`; `painthome.com.au`, `www`, and `painthome.localhost` (dev/e2e) → `painthome`, root rewritten to `/painthome`; `/painthome` on a dev host is served locally (Settings preview, C1), elsewhere it redirects to the domain. `entrySourceFor` → `painthome_home_hero|cta`. `otherAudienceHref("painthome")` is empty (no cross-link).
- `lib/marketing/hosts.ts` — the Paint Home domain is a marketing host (root = homepage, not login).
- `lib/marketing/brand.ts` (new) — the ONE brand record per shopfront: name, tagline, domain, phone, legal line (`Enlvn Pty Ltd trading as Paint Home`), "powered by", painter since-line, accent colour, LocalBusiness `@id` (Paint Home's own, `parentOrganization` → Paint Group's). `brandServer.ts` reads Settings → Brands over the defaults (error reported, never swallowed).
- `lib/marketing/paintHomeLogo.ts` (generated path data) + `PaintHomeLogo.tsx` — the mark inline; the test pins the module to both SVG files.
- `HomePage.tsx` — brand on nav, footer, phone lines, painter cards, reviews credit, metadata (own `metadataBase`, canonical, `PAINTHOME_INDEXABLE` robots) and schema; `<div class="site" data-brand>` wrapper carries `--brand-primary`. No trade lane, no "For business" link, no business chip on Paint Home.
- `app/(marketing)/painthome/{page,opengraph-image,icon}.tsx` — the route, the 1200×630 OG image (the one rasterisation), the favicon.
- `Nav`, `Footer`, `HowItWorks`, `Painters`, `Reviews`, `Hero`, `ClosingCta`, `GetPriceLike`, `TelLink`, `Audience.tsx` — brand-aware; `TelLink` takes the number from the provider.
- `estimateLink.ts` — `brand: "painthome"` option → `&brand=painthome` on every Paint Home hand-off (wizard reads it in Session 3).
- `/work` pages — brand on nav/footer; on Paint Home: homes only, Paint Group URL as canonical (⚑ P9), a commercial job redirects away.
- `next.config.ts` — `X-Robots-Tag` by host: Paint Home follows `PAINTHOME_INDEXABLE`, independent of `SITE_INDEXABLE`.
- Settings → Company → **Brands** (`BrandsSettings.tsx`, `brandsActions.ts`; one `settings` row `brands`): domain, phone, legal line, accent colour per brand. `SiteCopyEditor` takes a partial copy map so a Paint Home tab can join in Session 2.
- `lib/showcase/rank.ts`, `lib/marketing/reviewTags.ts`, `lib/marketing/copy/index.ts` — the `painthome` arm defaults to the `home` arm (brief §3).
- Help: `docs/help/paint-home/{staff,customer}.md`. `docs/ARCHITECTURE.md` paragraph.

## Proof
- Unit: `audience.test.ts` (+4 Paint Home cases), `hosts.test.ts`, `estimateLink.test.ts`, `brand.test.ts`, `paintHomeLogo.test.ts` — full suite 392 files green.
- e2e `e2e/marketing/painthome.spec.ts` (anonymous, phone): `x-audience: painthome` with no cookie; the mark + "powered by Paint Group"; no `#trade`, no business link, no link to paintgroup.com.au; Enlvn legal line; reviews credit; LocalBusiness `@id` under Paint Group's; canonical; address → See my price → `/estimate?…brand=painthome&mode=home&src=painthome_home_hero` on the Paint Home host. The Paint Group site: `/` home, `/business` as before. Settings → Brands: a phone number live on Paint Home within a minute and not on the homes site.
- Typecheck clean; `eslint --max-warnings 4` 0 errors.

## For Tom
1. Vercel → the project → Domains: add `painthome.com.au` and `www.painthome.com.au` (www → apex). No env var is needed for the domain to resolve.
2. Both sites stay `noindex`. Paint Home's flip is `PAINTHOME_INDEXABLE=1`, separate from Paint Group's.
3. Manual test (phone): open painthome.com.au → the Paint Home mark with "powered by Paint Group" → scroll: no "For business", footer says Enlvn Pty Ltd trading as Paint Home → type an address → See my price → the URL ends in `brand=painthome`. Then open paintgroup.com.au and confirm nothing has moved.

## Not in this PR (the brief's later sessions)
Paint Home's words (Session 2: `site_content` seed, Website copy tab, two FAQ entries, `featured_rank_painthome`, phone-close price ceiling on the cards); the wizard brand branch (Session 3: `brand` column, residential-only entry, Inside/Outside chips, phone-only tier and the handoff screen); comms and portal (4); staff brand pills and dashboard split (5); launch (6).

No migration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
