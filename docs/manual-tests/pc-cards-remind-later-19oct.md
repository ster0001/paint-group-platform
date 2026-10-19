# Manual test — PC Command: two cards gone, Remind me… on every card (19 Oct 2026)

No migration.

## 1. The two retired cards
1. Open **PC Command**. No card reads **… has not signed the finish standards**, and none reads **No public liability on file / no insurance on file**, whatever the painters' records say.
2. **Contractors** (sidebar) still shows the **Standards:** line per painter and **Send reminder text**; **PC Command → Contractors** still counts **Not signed**. The standards and certificate reminder texts still go by themselves (Settings → Automations).

## 2. Remind me… on a card
1. On any card in **Needs you now**, on a **Quality check to do** card, or on a line of the quality-check strip at the top, press **Remind me…**.
2. Pick a day after today (today or earlier is refused: "Pick a day after today") and press **Set**. The control reads **Back on <date>** and the card is gone on the next load.
3. The dismissal is logged with the reason *Remind me on <date> (PC Command)* (CRM → the customer's timeline when the item has a customer; otherwise only in the dismissals table).
4. On that morning (from 6:00 am) the card is back, provided what raised it still stands. To see it without waiting: in the SQL editor, set that row's `until` in `work_item_dismissals` to a minute ago and reload PC Command.
5. The cross (✕) on a console card still closes it off for good, as before.
