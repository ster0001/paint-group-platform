# Manual test — Home dashboard v2 · session 4 (Invoicing)

No migration this session.

1. **As a finance login** (Finance ticked only): Home shows Invoicing and Activity, nothing else.
   Invoicing has seven tiles; the "switches on" box is gone.
2. **Same instant as /invoicing.** Open /invoicing in a second tab. Outstanding and Overdue on Home
   equal the dashboard's Outstanding and Overdue tiles to the dollar. The "to approve" figure on
   Home's contractor line equals the Payables "to approve" tile.
3. **Overdue ageing.** The line under Overdue reads "1–7 $… · 8–30 $… · 31+ $… · oldest N days".
   Change the ageing edges under Settings → Dashboard (e.g. 14 / 45) and reload: the buckets follow.
4. **Received.** Record a cash payment on an invoice (Record payment → Cash). Received for This
   month rises by that amount and the line shows "cash $…".
5. **Press each tile**: the row count in the drill header equals the number on a count tile; the money
   tiles list every invoice behind them with balance and days overdue; Export CSV is the same rows.
6. **A sales login** never sees Invoicing; /api/reporting/export?metric=inv.overdue_cents is 403.
