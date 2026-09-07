# Manual test · CRM v2 Phase 7 — the scale gate, and dark / light

Branch `feat/crm-v2-p7-scale`. Source: `docs/briefs/crm-v2-deep-dive.md` §4.7 (decision 6.5: everyone, "mine" default),
shell brief 2A.10; Tom 7 Sep: "switch the view to either dark or light mode in all of the CRM". Automated:
`e2e/crm-p7-scale.spec.ts` (4), `e2e/crm-volume.spec.ts` (the gate), `lib/crm/work-queue.test.ts` (scope, grouping,
truncation). **No migration, no env.**

## Walk

1. **Dark / light.** Top right of every CRM page: ☀ / ☾. Click → the whole CRM re-skins at once (Today, Customers,
   the record, Campaigns, Diary, Settings' CRM folder stays Tailwind-light as before). Reload → it stays. Another
   browser → it follows the cookie there too once you choose. Every colour is a variable on `.crm[data-theme]`.
2. **Today → Mine / Everyone.** Mine (the default) shows your customers and anyone nobody owns; Everyone the whole
   team's queue. The heading, the group chips and paging follow the scope. The tab badge is the team's number.
3. **One card per customer per bucket.** Two overdue items for the same customer sit under one card: the lead
   line, then "also …" lines each with its own action and dismiss. An overdue follow-up and a due-today callback
   stay two cards — the urgency differs.
4. **Never a silent cap.** Every source read is ordered oldest-first and capped (500 follow-ups, 500 invoices,
   200 callbacks, 300 online estimates, 300 lapsed, 400 messages, 200 rebooks). When a read fills its cap an
   amber line names the sources — "the oldest are shown first; clear them and the rest surface".
5. **The badge fast path.** Open Today, then click between tabs: the badge comes from a 45-second per-user cache
   (`/crm/api/badge` answers `cached: true`); `?fresh=1` rebuilds. A dismissal forgets the cache so the number
   drops at once. The layout no longer rebuilds the queue on every CRM page.
6. **Customers → Owner → Mine** (or `?owner=me`): your customers only.
7. **"/"** from anywhere in the CRM focuses search (⌘K still works). **Help → "Your first hour in the CRM"**
   (`docs/help/crm/staff.md`) is the onboarding page.
8. **The volume gate** (`e2e/crm-volume.spec.ts`): Today, Customers, a record, the Diary, the lists and the badge,
   timed on the 27k-account test project. Dev server, 7 Sep: Today 1.4 s, Customers 0.6 s, record 0.4 s, Diary 0.8 s,
   lists 0.55 s, badge fresh 1.4 s / cached 0.1 s. Run it on a production build via `scripts/c1/run-e2e.sh` with
   `CRM_VOLUME_MS=500` for the brief's p95 target; every Today source query measured directly is under 500 ms.

## What the scale work did not change (deliberately)
- No per-staff RLS: decision 6.5 says everyone sees everyone, with "mine" as a filter. Revisit past five staff.
- The 30-minute cron cadence (decision 6.9, Vercel Pro) is still Tom's; the sweeps are idempotent either way.

## Traps found building it
- Two Playwright runs on one dev server made every page read 8–10 s; measured alone the same pages are under 1.5 s.
  The gate runs on its own.
- A 500-invoice source fed a 500-id `in` list to the payments read — a 19 KB URL. Every id-keyed read in the loader
  now goes in slices of 120 (`inSlices`), the P5 lesson applied to Today.
- Grouping must be per bucket: grouping across buckets hid an item whose sibling led a different bucket.
- The stylesheet had 40 literal colours outside the variables; they are variables now (`--fg2`, `--hover-line`,
  `--dim`, `--ph`, `--cold`, `--bubble`, `--shadow`, `--top`, `--good`, `--bad-text`…), so a new colour must be a
  variable or it will not follow the theme.
