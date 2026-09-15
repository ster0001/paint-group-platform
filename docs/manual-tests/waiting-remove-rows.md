# Manual test — Estimates → Waiting on you: remove rows from this list (15 Sep 2026)

Migration to paste first (test AND prod): `supabase/migrations/20270147000000_estimates_waiting_hidden.sql`.
The paste ends with a `select` listing the policy; expect one row, `ewh_staff_select`.

1. Sign in as staff, open **Estimates**. The Waiting on you tab now has a tick box on each row and one in the header.
2. Tick a row. A bar appears: "1 selected · Remove from this list · Clear", with the note that the CRM keeps the item.
3. Press **Remove from this list**. The row goes at once; a line says "1 row removed from this list. It's still in the CRM." with **Undo**.
4. Press **Undo**. The row is back. Reload — still there.
5. Tick it again, remove, reload. Still gone.
6. Open **CRM → Today** (Everyone). The same item is still listed there, with its Dismiss control untouched.
7. Header tick box selects every visible row; Clear empties the selection without removing anything.
8. Before the migration is pasted, Remove shows "Removing rows from this list needs migration 20270147 run first" and the rows come back.

Undo after a reload is not offered: a removed row comes back on its own only when the fact re-fires under a new key
(e.g. a call request becoming a visit request). To bring one back by hand, delete its row from `estimates_waiting_hidden`.
