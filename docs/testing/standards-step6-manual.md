# The painter's traffic light, Step 6 — manual test script for Tom

Branch `feat/painter-traffic-light`.

## Before you start
1. Paste `supabase/migrations/20270229000000_painter_status_visible.sql`. Read-back: visible_grant true, gated_policies 2, visible_now true.
2. Deploy. Painters see their status at once (the switch defaults ON). To run staff-only first: Settings → `painter_status_rules` → `statusVisibleToPainters: false` (DB for now).

## Painter (phone, both themes)
1. Sign in as a contractor. Home has **Your status** above the offerable card: the light with one lamp lit (blue ring = New), the word, one line, the bars to Green. Tap it.
2. **My status**: the reason line matches the Painters table in PC Command; **Steps to Green** or **Clean jobs in a row** with **Next bonus review "n of 4"** — no dollar amount anywhere; **What you get**; the three measures as counts; the dots (tap one); three tips; **How the colours work**.
3. Toggle the theme: the status word changes shade so it reads on white; the lamps stay the same colours.
4. iPhone Settings → Accessibility → Motion → Reduce Motion: the lamp stops pulsing.
5. Sign in as an employee who has led a job: the card reads **Your status · jobs you led** and never mentions priority or 3 business days. A crew employee has no card and `/portal/status` is "not found".

## Texts
1. Change a painter's colour (the next sweep after a result changes, or for a check: run `?only=status`): the painter gets message 6 — "you are on Green…" or "your status is now Orange. Open the app…". Settings → Automations → **Painter status — your colour changed** has the three wordings.
2. A Green painter's third reminder text reads "update today to keep your Green".

## What to tell me
- The three tips per colour (`lib/painterStatus/copy.ts`) — wording is mine, from the mockup's examples.
- Whether to launch painter-facing straight away or staff-only for a week (⚑21).
