# Manual test — Home dashboard v2 · session 1 (reporting core + /home shell)

Run `20270180000000_dashboard_metrics_daily.sql` (with `set lock_timeout = '15s';` first) and read
the select: expect `table_expect_1 = 1`, `policies_expect_1 = 1`, `rls_on_expect_true = true`.
Vercel: the new cron `/api/cron/metrics-daily` at 16:00 UTC (2 am Melbourne) needs `CRON_SECRET`,
which the other crons already use.

1. **Home in the rail.** Sign in as the master user: **Home** is the first entry. It opens /home with
   "Good morning/afternoon, <name>", the period chips (This month pressed) and the days in view.
2. **Needs doing.** The dark strip lists the cards that are yours today, critical first, each with a
   button that opens the right screen. A quiet day reads "Nothing is waiting on you right now."
3. **Sales tiles.** Estimates sent, Sales $, Sales (number) for the period, with the arrow against
   last month's same days. Press **Estimates sent**: the rows open beneath with a row count; **i**
   shows the definition; **Export CSV** downloads the same rows (row count = the tile).
4. **Not-live sections** (Where estimates go, PC Command, Contractors, Invoicing, P&L, Marketing,
   Activity) read "Switches on when … ships". No zeros.
5. **Chips.** Last 30 days / Quarter / Year to date change the days in view and the comparison;
   **Custom** shows From/To with Apply.
6. **Roles.** Sign in as a login with only Sales ticked: Home shows Sales + Where estimates go +
   Activity, nothing else. Only Project coordinator: PC Command + Contractors + Activity. Only
   Finance: Invoicing + Activity. Paste `/api/reporting/export?metric=sales.estimates_sent` in the
   finance login's browser: a JSON "not available to this login" (403), never an empty file.
7. **Cron.** `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/metrics-daily?days=3`
   returns `written` for three days; `metrics_daily` has one row per period metric per day.
