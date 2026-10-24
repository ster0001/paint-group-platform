# Paint Home — Session 2: the words (copy set, migration, Inside/Outside, ten FAQs, the cards' price ceiling)

**Brief:** `docs/briefs/paint-home.md` §4, §8.2. Follows #365 (Session 1, brand plumbing, live on painthome.com.au).

## What this is
Paint Home now speaks in its own words. The copy set is taken from the prototype (`design/reference/paint-home-homepage-prototype.html`, which the brief says wins where they differ: the H1 is the tagline *Your qualified local painters.*). Paint Group's words, pages and tokens are untouched.

## What changed
- **`lib/marketing/copy/painthome.ts`** — the full set: nav (Real jobs, real prices · How it works · Who'll be painting · Reviews), hero, four self-typing examples all under $12,000 with their inside/outside scope, How it works (*Price it online* / *We confirm it by phone* …), *Real jobs. Real prices.*, the four promises, the story captions, *This month at Paint Home*, *Who does the work.*, *What customers say.*, ten FAQs (*Who is Paint Home?* first, the big-job one fifth), *See your price today.*, meta.
- **`painthome.test.ts`** pins the §1a/§4 rules: no "business / commercial / agent / PO / portfolio / trade" outside the big-job answer; "Paint Group" in exactly one string (the end of *Who is Paint Home?*; with the nav small print, the reviews credit and the footer that is the page's four); no exclamation marks, slang or system words; every example under the ceiling.
- **Schema** (`copy/schema.ts`): `hero.chip_interior/chip_exterior`, `estimator_examples.example_4_*` and `example_N_scope`, `reviews.lead`, `faq.q_9/a_9/q_10/a_10`. `missingKeys(copy, audience)` now takes per-audience optional keys; home and business sets unchanged.
- **Hero / CTA**: on Paint Home the chips are a **scope** (`AddressField chips="scope"`: Inside / Outside, `scope_interior` / `scope_exterior` events, the ghost lights the example's chip); `onSubmit(address, mode, scope)`; the hand-off carries `scope=interior|exterior` with `brand=painthome`. Session 3 reads it in the wizard.
- **Cards**: `rankShowcaseJobs(jobs, "painthome", maxHighCents)` — home jobs with a top price at or under the phone-close ceiling (`wizard_policy.remoteConfirmCapCents`, ⚑ P7 = Paint Group's value), by `featured_rank_painthome` then newest, never commercial, never unpriced. Showcase editor gains the Paint Home rank; `lib/showcase/actions.ts` keeps one holder per rank. Paint Home placeholders are the prototype's three.
- **Reviews** lead line; **FAQ** renders up to ten and the FAQPage JSON-LD follows; **404** (`not-found.tsx`) renders the request's brand so a mistyped Paint Home URL stays Paint Home.
- **Settings → Website copy** gains the **Paint Home** tab (preview `/painthome`); saves revalidate `/painthome`.
- **Migration `20270299000000_paint_home_content.sql`** — `site_content.audience` admits `painthome`; `showcase_jobs.featured_rank_painthome` + its unique index; the 117 seed rows (generated, `on conflict do nothing`); read-back with `_expect_` values; registers itself.
- Help `docs/help/paint-home/{staff,customer}.md`; `docs/ARCHITECTURE.md` paragraph.

## Proof
- Unit: `copy/painthome.test.ts`, `copy/schema.test.ts` (three sets), `showcase/rank.test.ts` (+3 Paint Home cases), `marketing/*` — full suite green. Typecheck clean; `eslint --max-warnings 4` 0 errors.
- e2e `e2e/marketing/painthome.spec.ts`, five journeys on a phone: the words (title, H1, ten FAQs, Inside/Outside, "Paint Group" ×4 in the page text, banned words absent), the brand, the hand-off `brand=painthome&scope=exterior&src=painthome_home_hero`; the Paint Group site untouched (home H1, eight FAQs) and a Paint Home 404 stays Paint Home; Settings → Brands live within a minute; a ranked home job over $12,000 never shows while one under it does, and the homes site ignores the Paint Home rank; the Paint Home copy tab edit live within a minute. **Run status:** see the PR's e2e job — the local C1 run was refused because the main-branch CI e2e held the test project (one run at a time; CLAUDE.md), so the result is this PR's CI run.

## For Tom
1. Paste `supabase/migrations/20270299000000_paint_home_content.sql` in the SQL editor (starts with `set lock_timeout`), read the read-back row against its `_expect_` values, then check `_prod_migrations` has the row. The pages render the same words from code before the paste; after it, the Paint Home tab in Website copy saves.
2. Manual test (phone): painthome.com.au → *Your qualified local painters.* → tap **Outside** → an address → **See my price** → the URL ends in `brand=painthome&scope=exterior`. Scroll: ten questions, the first *Who is Paint Home?*; count "Paint Group": nav, under the reviews, in that answer, footer. Then paintgroup.com.au: unchanged.
3. Settings → Showcase jobs: give three home jobs under $12,000 the Paint Home rank 1–3 (P4: real anonymised jobs when you have them).

## Not in this PR
Session 3 (wizard brand branch: `brand` column, residential-only entry, scope pre-selected, phone-only tier and the handoff screen, Sarah's intro), 4 (comms and portal), 5 (staff pills, dashboard split), 6 (launch: Clarity, sitemap, remove noindex).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
