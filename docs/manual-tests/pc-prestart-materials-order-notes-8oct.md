# Manual test — PC pre-start lists, soonest-first Pre-start, reminder notes (8 Oct 2026)

Before you start: migration `20270243000000_pc_prestart_lists_and_work_item_notes.sql` is pasted on production and its read-back row matches every `_expect_` column (and a row for it is in `_prod_migrations`).

## 1. Materials and equipment lists
1. Projects → Project progress → open any job in **03 Pre-start** (or 02 Booking confirmed).
2. Scroll to the **Pre-start** card. Under **Materials ordered** there is a box; under **Equipment movements booked** another.
3. Type a materials list, press **Save materials list** → **Saved** appears. Do the same for equipment.
4. Check neither item got ticked.
5. Reload the page → both lists are still there. Change one and save again → the new text stays after a reload.
6. Open the same job from the painter's login (or Painter's view) → the lists are not shown to the painter.

## 2. Pre-start order and orange
1. Projects → Project progress. Look at **03 Pre-start**.
2. The card at the top has the soonest start date; the dates run later going down.
3. Any job starting today, tomorrow, or in 2 or 3 days is filled orange with **STARTS TODAY / STARTS TOMORROW / STARTS IN N DAYS**. A job past its start date and not started says **START DATE PASSED**. A job 4+ days away is not orange.

## 3. Notes on dashboard reminders
1. Projects → Dashboard. On any card under **Needs you now**, press **+ note**.
2. Type "Rang them — back Friday" and press **Save** (or Enter). The note shows in italics on the card.
3. Reload → the note is still there on that card.
4. Tap the note, clear the box, Save → the note is gone.
