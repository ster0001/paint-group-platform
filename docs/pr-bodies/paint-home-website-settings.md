# Settings → Paint Home website: hero photo, every word, the project cards — one clearly labelled folder

**Tom, 25 Oct 2026:** "I can't see the website for Paint Home in the settings page to be able to update anything, the same as the Paint Group page — please add it, labelled clearly as Paint Home website, so I can edit the hero image etc and add more projects." No migration.

## What changed
- **Settings → Company → Paint Home website** (`PaintHomeWebsiteSettings.tsx`), right after *Website*:
  1. **Hero photo** — Paint Home's own (`website_content.heroPhotoPaintHome`, new field); the Paint Home homepage draws it, falling back to the homes photo. Saved field-by-field (`savePaintHomeHeroAction`) so it never overwrites the Website folder's row.
  2. **Every word on the site** — the Paint Home copy editor, moved here from the *Website copy* folder (which keeps Homes and Businesses).
  3. **Project cards** — every published home job with its top price, whether it qualifies for Paint Home (priced at or under the phone-close ceiling), and a **Paint Home card** rank 1–3 set inline (`setPaintHomeRankAction`, clearing the previous holder as the job editor does); **Add a new project →** and **All showcase jobs →** links.
- The *Website* folder's subtitle now says it is the Paint Group homepage.

## Proof
- Unit `lib/marketing/siteContent.test.ts` (the new field parses and defaults); full suite green; typecheck clean; lint 0 errors.
- e2e `e2e/marketing/painthome.spec.ts` test 5: edits a Paint Home FAQ answer through the new folder (hero upload and new-project link present), proves it live on Paint Home and not on the homes site, and that the Website copy folder has no Paint Home tab. Local C1 result in the PR conversation; otherwise the PR e2e job.
- Help `docs/help/paint-home/staff.md`; `docs/ARCHITECTURE.md`.

## For Tom
Settings → Company → **Paint Home website**: upload the hero photo and Save; the words; give your jobs a Paint Home card rank or add a new project. Nothing to paste.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
