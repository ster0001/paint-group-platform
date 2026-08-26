# Portal 3a-4 — the Project Timeline

**What this ships:** /account → My project is real. NO migration — the
whole feed renders from what the WO loop already captures.

- **Where everything is up to** — each area with customer words only:
  Not started / Being prepped / First coat / Done ✓, plus "Day 3 of 6"
  from the booking dates.
- **Who's at your home** — the painter's FIRST name only, and the
  coordinator card with the office number. No rates, no surnames, no
  company details ever cross the line.
- **Day by day** — newest first, with day headings and a live dot on
  today: your PC-approved daily updates (drafts can never leak — only
  status=sent renders), site photos as SIZED RENDITIONS behind signed
  URLs (never originals — §10.3; tap for full screen, still a rendition),
  and milestones: deposit received, we're underway, quality check passed,
  walkthrough booked, ready for your look around, signed off.
- **Variations** — a priced one waiting on the customer renders as
  "Something needs your say-so" with the price and a Review & approve
  button straight into the existing /v signing flow; approved and
  declined ones stay on the record in kind words.
- **The QA ruling holds** — a PASSED check is a friendly milestone;
  failed checks and qa-kind photos are never even fetched.

## Your check (after deploy)

Your live jobs have real ticks and photos, so: portal → My project.
You should see 23a Oakdene (or whichever job is most active), its areas
rolled up, and the day-by-day feed. Tap a photo — it opens full screen.

## Proof in CI

- `e2e/portal-timeline.spec.ts` — the full visibility law in one spec on
  live: sent-only updates, draft text absent, qa photo absent, exactly
  the customer photos as /render/ rendition URLs, first-name-only crew,
  /v deep link with the right token, lightbox open/close.
- `lib/portal/timeline.test.ts` (8 tests): rollup wording, newest-first,
  photos riding their day's card, variation states, Melbourne day
  bucketing (23:00 UTC = next Melbourne day).
- Unit 989 · tsc + lint clean.
