# Manual test — Projects console, pinned names, live ticks, site photos

**Branch:** `feat/projects-console-photos` · 2026-08-22

## Before you start — one bit of SQL

Everything below works except the LAST check without it, but do it first and
you can test in one pass.

Paste `supabase/migrations/20261024000000_wo_ticks_by_token.sql` into the
Supabase SQL editor and run it. **Read the output**: it should print one row,
`get_work_order_ticks_by_token`, with `security_definer = true` and
`anon_may_execute = true`. If it prints nothing, the statements did not apply —
say so rather than carrying on.

Nothing else needs a migration.

---

## 1 · The schedule is now the first tab of Projects

1. Sign in as staff. Look at the left sidebar.
   - **Schedule is gone from the sidebar.**
   - "Live jobs" now reads **Projects**.
2. Click **Projects**. You land on the console.
   - The tab rail reads **Schedule · Command · The flow · Updates**, in that
     order, and the tab you are on is highlighted.
3. Click **Schedule**. The timeline you used to reach from the sidebar opens
   inside the console, full width.
4. Type `/schedule` into the address bar by hand. It should send you to
   `/pc/schedule` — old bookmarks still work.

## 2 · Contractor names stay put while you scroll the dates

1. On the Schedule tab, scroll the timeline sideways — a few weeks out.
2. The contractor column (name, tier, READY badge) **stays pinned to the left**.
   Blocks slide underneath it; nothing shows in the gap beside a name.
3. Scroll back. Nothing has shifted.

## 3 · The days are named

1. Look at the top of the calendar. Each column reads the **day name over the
   date** — `MON` above `31`, `TUE` above `1`.
2. Drag the ZOOM slider all the way down. The names shorten to a single letter
   rather than disappearing.
3. Today's date is still cyan; weekends are still dimmed.

## 4 · A ticked-off area no longer says "Not started"

Use a job a painter has actually been ticking (2 Beech Rise is one).

1. Projects → **The flow** → open the job. Note the **Scope & ticks** list:
   some surfaces read PREPPED, some DONE.
2. Click **Edit job sheet**. The Work order tab opens.
3. Scroll to **Scope of works**. Each surface's pill now matches the tick list:
   **Prepped** (cyan), **Complete** (green), **Not started** (grey) — not
   "Not started" on every line.
4. Open the contractor link (`/w/<token>`, the "Re-issue + copy link" button
   gives it to you). **The same states appear there.** ← this is the check that
   needs the SQL above; without it every line reads "Not started".

## 5 · The painters' photos are visible

1. Projects → **Command**. At the bottom: **Latest from site** — a card per job
   with the newest photos, newest job first. Click a photo: it opens full size.
   Click **Open job →**: it takes you to that job.
2. On the job screen, right-hand column: **From site**, with a count, grouped
   **Before / Progress / Variation / QA / Completion**. Only the groups that
   have photos appear.
3. Find a job with a **variation**. The photo the painter attached when they
   raised it now sits **inside the variation card**, above the pricing box. A
   variation with no photo says so plainly.
4. On the job sheet (Work order tab, and the contractor link), a **Site photos**
   section appears under the scope, grouped the same way. Print preview
   (`⌘P`): the photos are **not** in the printed job sheet — the trade counter
   doesn't need them.
5. A job with no photos yet says "Nothing sent in yet…" rather than showing an
   empty box.

## What to watch for and tell me about

- A photo tile that never loads (a grey box). The links are signed and last an
  hour — reload the page and it should come back. If a tile is permanently
  missing, the file behind it is gone and the row is an orphan.
- Any customer price, margin or surname appearing on the contractor link. There
  should be none; the photos carry only a caption and an area.
- The console feeling narrow on the Schedule tab, or wide anywhere else.
