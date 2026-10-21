# Manual test — Movements, week one (20 Oct 2026)

Fifteen minutes on a laptop, then two on your phone. Needs migrations `20270279`, `20270281` and
`20270282` on production (`select name from public._prod_migrations where name like '2027028%';`),
the suppliers seed run (Settings → Movements → Suppliers shows the branches) and the two staff
calendars connected (Portal → Calendar).

## Before you start (Settings → Movements, once)
1. **Movements**: set the warehouse address; add **Felipe** and **you** as board people in **1-hour slots**,
   **Saul, Adi, Abdul** in AM/PM; pick a colour each. Leave Nearby at 7 km. Save.
2. **Equipment**: replace the template rows with the real list (or hand me the CSV).
3. **Suppliers**: type the trade account references; untick anything you never use.

## Plan next week (laptop, Thursday)
1. Projects → **Movements**. The headline names next week and how many chips are in the tray.
   Every chip came from a job: one paint chip per brand (from the Materials card), one chip per
   materials line, one **Rubbish — how?** per job. Nothing to type.
2. Drag a **paint chip** onto **Supplier delivers**, Monday AM. The card says *Not ordered yet*.
   Open the chip: the nearest delivering shop is already picked. Press **Copy order text**, place
   the order with the shop, then **Ordered ✓**. Expect the toast to say the painter will be told,
   and Settings → Automations → queue to hold the drafted text (approve it there this week).
3. Drag a **materials chip** onto a **painter's** lane. Open it, pick the shop, **Ordered ✓** when
   placed: the pickup text (shop, address, from-time, order ref) is drafted.
4. Add a **gear chip** (+ Add a chip → Gear → tick the ladders) and drop it on **Felipe, Mon 07:30**.
   Expect its **return chip** to appear in the tray dated the job's last day; drop that on whoever
   is passing. Look for the **Nearby** pill and a **While you're there** line under Felipe's
   calendar entries — tap one.
5. Answer every **Rubbish — how?** chip (Painter disposed · Painter drops at warehouse · Left on site).
6. **Day** → Monday → Felipe: the numbered run from the warehouse with km. Press **▼** on one stop and
   watch the times swap. **Send to Felipe's phone** (draft-first: approve it in the queue).
7. Open one job's page: under **Materials ordered** the chips and the lines; tick it — it refuses until
   every paint chip is ordered, or press **Not needed** / **Painter supplies**.

## Run Monday (phone)
1. Felipe opens the text's link → his run for the day with **Navigate**, **Ring** and **Done** on each stop.
2. A painter opens the portal: **Your pickups and drop-offs today** with **Picked up ✓**; the job sheet's
   **Getting it to site** section says what is delivered and what to collect.
3. **Gear** tab: every item's pill moves as the ticks land; a job closed with gear on it turns **clay**,
   and **Find it in the tray** opens its return chip.

## If it goes wrong
Settings → Movements → untick **Show the Movements tab**. The tab and its screens go; nothing is
deleted; the old pre-start text is already in place as lines. The texts stop when the five Movements
automations are set back to *Office approves first*.

## Write down everything that made you stop and think
`docs/briefs/movements-s4-notes.md` — that list is the hardening input.
