# Manual test — Tom's 23 Aug batch

**Branch:** `feat/tom-batch-23aug` · 2026-08-23

**No SQL to run.** Nothing in this batch needs a migration.

---

## 1 · Settings save again

1. Settings → **Pricing & job numbers**.
2. The list is now **numbers only** — the config rows that used to sit in there
   (`wizard_policy`, `wo_loop`, `service_area`, `wizard_public`) are gone. Each
   field shows its unit and its note ("$ / week", "Calculated").
3. Set your three figures:
   - **Weekly marketing** → `1741`
   - **Weekly fixed costs** → `5847`
   - **Overhead per billable hour** → `20.97`
4. **Save all** → "Saved ✓". No red error.
5. Reload the page. The three numbers are still there.

> Note: *Total weekly overhead* and *Overhead per billable hour* are marked
> "Calculated" but nothing recalculates them — they are your numbers to type.
> At $5,847 + $1,741 over 480 billable hours the arithmetic would give $15.81,
> so if 480 is stale, change **Billable hours per week** to match.

## 2 · Deleting an estimate

1. Estimates → **Delete** on any draft → **Delete** to confirm.
2. The row goes **immediately**. No spinner, no wait.
3. Refresh. It is still gone.
4. Tick several and **Delete selected** — they all go at once, and a count
   ticks along underneath while the server works through them.
5. Try deleting one the database refuses (one with a work order). It comes
   **back** into the list with the reason underneath. That is the only case
   where a row returns.

## 3 · The sidebar on a phone

1. Open the app on your phone, or narrow the browser to about 390px.
2. The nav is gone; there's a **menu button**, the logo, and the name of the
   page you're on. The page has the full width.
3. Tap the menu → it slides in over a dim background. Tap a link → it goes
   where you asked and closes itself. Tap outside, the ×, or press Escape →
   it closes.
4. Widen the window back out — the sidebar comes back as it always was.

## 4 · Balustrades

1. Open a customer estimate link → **the editor**.
2. In every room's tile grid, alongside Walls and Ceilings, there is now
   **Balustrades & hand rails**. Tap it: it turns on and the price moves.
3. Outside, on an exterior side, the same thing is called **Balustrades & hand
   rails** too — it used to be filed under "Hand rails", which is why searching
   for "balustrade" found nothing.

## 5 · Plastering and raw timber

On the **capture screen**, in a room's *prep, coats & notes* step, there's a new
block: **Also in this room**.

1. **Plastering** — type hours (decimals fine: `2.5`) and where
   ("hallway ceiling crack").
2. **Raw timber — seal first** — hours and where ("new architraves").
3. **Next room →** to commit.
4. Open the estimate in the builder. Both are lines in that room, priced at
   **hours × your charge-out rate** (2.5 h interior = $212.50 at $85/hr).
5. The "where" is on each line's crew note, so it reaches the work order. The
   raw-timber note is stamped **"RAW TIMBER — seal before topcoats."** in front
   of whatever you typed — and the stamp goes on even if you leave the hours
   blank, because the crew still has to know.

> In the **builder** itself, plastering has always been available as a line
> item: **+ Line item → Plaster Repair**, hourly, with hours, rate, the
> customer-facing description and a crew note. Nothing changed there.

## What I could not reproduce — please check

**Removing architraves.** I turned architraves on in the customer editor, tapped
the tile off, reloaded, and they stayed off. If it fails for you, tell me which
screen and roughly when, and I'll find the failed save.
