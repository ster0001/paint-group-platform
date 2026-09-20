# Manual test — Home dashboard v2 · session 6 (finish)

Migration **20270183000000_dashboard_range_indexes.sql** (five indexes, no data change) — paste on prod with the
`set lock_timeout` line, read back `indexes_expect_5 = 5`, confirm the `_prod_migrations` row.

1. **Landing.** Sign out, sign in as any staff login: you land on **/home** (not /estimates). Contractors still
   land on /portal, customers on /account.
2. **Definitions everywhere.** On every tile there is a small **i** top-right. Press it: the definition appears
   under the row of tiles, with "right now" or "moves with the period" and the GST basis. Press again to hide.
   The same **i** is on every rows card and inside every opened drill.
3. **Comparison arrows.** Period tiles show ▲/▼ N% vs <month> in green/clay, "same as <month>" when equal,
   "none in <month>" when last period was zero; right-now tiles carry the "right now" pill and no arrow.
4. **The strip streams.** Reload as an owner: the sections appear first; the needs-doing strip says "Working
   out what needs you today…" for a moment, then fills with the cards. The count and cards are unchanged from
   before.
5. **Phone.** Open /home on your phone (the C1 stack: ./scripts/c1/serve.sh, then http://<mac-ip>:3101/home).
   Against design/reference/home-dashboard-light-mockup.html at the same width: two tiles per row, the strip
   scrolls sideways with snap, cards stack one per row, no horizontal page scroll, chips wrap.
6. **Speed.** The page's root carries `data-timings` (Inspect → the div with data-testid="home"): the loaders
   total. On the test project, warm, an owner sees 0.9–1.4 s; the strip's own time is `data-queue-ms` on the
   needs-doing box (~2 s, the CRM queue's fifteen round trips — streamed, not on the critical path).
7. **Export of a big list.** As owner, Activity → Year to date → Export CSV: the download starts at once and
   streams (no wait for the whole file), opens in Excel with the header row and one row per event.
8. **Full loop (automated).** `e2e/dashboard-full-loop.spec.ts` drives one job estimate → accepted → booked →
   live → variation → sign-off → invoice → payment and asserts each tile moved by exactly that job's amounts as
   owner, PC, sales and finance, with 403 where a role has no tile.
9. **Help.** /help → Dashboard: the office guide (staff) and the project coordinator guide (pc).
