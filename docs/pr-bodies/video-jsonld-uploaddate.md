# Videos structured data: every VideoObject carries uploadDate (Search Console, 28 Oct)

**Google Search Console, 28 Oct 2026:** "Videos structured data issues detected in https://painthome.com.au/ — Missing field uploadDate" (critical; the flagged item is the featured video *Andrea - Sandringham - Full Exterior Repaint*). No migration.

## What changed
- **One VideoObject builder**, `lib/marketing/videoLd.ts` (`videoObjectLd`), used by all three places that mark up a video: the homepage's featured video when it is a pasted link (`Reviews.tsx`, which had no `uploadDate`), the homepage's featured video when it is a showcase job's (which had no structured data at all — it now gets the same block), and the job page (`/work/[slug]`, whose `uploadDate` was `undefined` for a job never marked published). The field can no longer be left out.
- **The date itself.** A showcase job's video: its publish day, else the job's completion day, else the row's creation day (`videoUploadDateFor`). A pasted testimonial link: a new `featuredVideo.addedOn` on the website-content row, written by the Settings → Website save; until that row is saved again, an older row reads as today in Melbourne (`melbourneDay`, an Intl day pinned to the zone).
- Thumbnails: empty entries are dropped from `thumbnailUrl`.

## Proof
- Unit `lib/marketing/videoLd.test.ts` (uploadDate always present, the fallback ladder, the Melbourne day); `siteContent.test.ts` for the new field; full suite green; typecheck clean; lint 0 errors.
- The pages render the same HTML apart from the `<script type="application/ld+json">` blocks, so no e2e change; verify after the deploy with Google's Rich Results test on `https://painthome.com.au/` and `https://paintgroup.com.au/`, then **Validate fix** in Search Console.

## For Tom
After the deploy: open Settings → Company → Website and press **Save** once (that writes the pasted video's added-on date), then in Search Console press **Validate fix** on the Videos issue. Nothing to paste.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
