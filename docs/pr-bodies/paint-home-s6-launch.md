# Paint Home — Session 6: launch plumbing (robots and sitemap per site, Clarity per brand, the website's numbers by shopfront)

**Brief:** `docs/briefs/paint-home.md` §7, §8.6. Follows #365, #366, #369, #371, #373. No migration.

## What changed
- **`app/robots.txt/route.ts`** — one robots file per site, by host. Paint Home follows `PAINTHOME_INDEXABLE`, Paint Group `SITE_INDEXABLE`; each names only its own sitemap; the platform host is never indexed. (The `X-Robots-Tag` header stays as the belt to this brace.)
- **Sitemap** — on the Paint Home host it lists `/` and `/work` only: a job page's canonical is the Paint Group URL (⚑ P9), so Paint Home never offers one for the two sites to compete over.
- **Clarity per brand** — `NEXT_PUBLIC_CLARITY_ID_PAINTHOME`; the loader picks the project from the page's audience and still loads only after "Allow analytics". Unset = Paint Home records nothing.
- **Dashboard** — *By shopfront* now carries the website's own numbers from the `web_event` rows `track()` writes (the audience is already on each): visits (distinct first-party visitor ids), addresses typed, See-my-price taps, per brand, beside the session numbers. That completes the brief's side-by-side list.
- **`docs/testing/paint-home-launch.md`** — the order of operations, the 90-second phone walk, the flip, and the open decisions still assumed.
- Help `docs/help/paint-home/staff.md`; `docs/ARCHITECTURE.md` paragraph.

## Proof
- Unit `lib/reporting/metrics/brand.test.ts` (the row with the website numbers); full suite green; typecheck clean; lint 0 errors.
- e2e `e2e/marketing/painthome-launch.spec.ts`: robots per host (Paint Home's own, disallowing all while the switch is off; the platform's naming nothing of Paint Home), the Paint Home sitemap with its own two pages and no job page, the homes sitemap untouched. Local run: see the note in the PR conversation; the PR's e2e job is the result.
- Lighthouse (mobile) on the Paint Home homepage, test-stack build: see the PR conversation for the score.

## For Tom — the launch itself (in `docs/testing/paint-home-launch.md`)
1. Clarity project "Paint Home" → `NEXT_PUBLIC_CLARITY_ID_PAINTHOME` in Vercel, redeploy.
2. Resend: verify painthome.com.au as a sending domain (until then: Paint Group mailbox, "Paint Home" display name).
3. Settings → Showcase jobs: three home jobs under $12,000 ranked for Paint Home.
4. The 90-second walk on your phone.
5. `PAINTHOME_INDEXABLE=1` → redeploy → check robots, sitemap, `x-robots-tag: all`; Search Console property + sitemap.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
