# Manual test — Home dashboard v2 · session 5 (P&L + Marketing)

No migration this session. Owner or admin login throughout; ⚑2 says nobody else sees any of it.

1. **As the owner**: Home shows P&L and Marketing sections after Invoicing; the "switches on" boxes are gone.
   Every P&L tile line ends with "Settings basis until MYOB".
2. **Contracts signed** for This month = Sales $ (in the Sales section) ÷ 1.1, to the dollar. Press it: one row
   per acceptance with the ex-GST contract.
3. **Revenue received** = Invoicing's Received ÷ 1.1 for the same range (Received is inc GST, this is ex).
4. **Gross margin, actual**: press it. Each signed-off job in the range shows contract ex GST, the engine's
   estimated margin, actual cost (contractor invoices approved/paid + supplier invoices + job costs + approved
   expenses), actual margin and the difference. A job whose estimate has no priced scope is not listed.
   Compare one job with its /pc/wo page: the Materials card's "invoiced" figure is the same number.
5. **Net margin** is a rows card: gross, then "Fixed overhead · N weeks × $…" from Settings "Weekly fixed costs",
   then marketing. Blank the weekly fixed cost in Settings → the overhead line disappears and the note says so.
6. **Marketing spend rows win over the weekly figure.** Settings → Dashboard → Marketing spend: add a row for
   last month (e.g. Paid Google, $3,000). Set the range to last month (Custom): Net margin's marketing line reads
   "recorded for 1 month · −$3,000"; **Cost per accepted job, by channel** lists Paid Google with the acceptances
   whose lead source is Paid Google. This month (no row) falls back to "Weekly marketing" × weeks.
7. **By lead source**: one row per source over estimates sent in the range; "Not recorded" for blanks.
   Sent, accepted, conversion, average and revenue — the sent count sums to the Sales section's Estimates sent.
8. **Repeat + referral share**: press it. A customer with an earlier accepted estimate shows Repeat = yes with
   no flag typed anywhere; Referral follows the lead source.
9. **Spend vs sales, twelve months**: twelve rows, "recorded" where a month has spend rows, "Settings" elsewhere.
10. **Anomaly card.** Accept an estimate large enough to push Contracts signed ≥ 25% above last month's same
    days (or lower the anomaly threshold under Settings → Dashboard → Thresholds to 1%). Reload: an
    "Amber · trend" card "Contracts signed up N% vs August" sits in Needs doing; "See the tile" jumps to P&L.
    Put the threshold back.
11. **A PC / sales / finance login** never sees P&L or Marketing, never the trend card, and
    /api/reporting/export?metric=pl.gross_margin_actual and ?metric=mk.by_source answer 403.
