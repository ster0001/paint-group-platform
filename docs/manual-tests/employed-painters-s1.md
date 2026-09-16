# Manual test — employed painters, Session 1 (identity + money contract)

Needs migration `20270153000000_employment_type.sql` applied (test project first). Nothing here is reachable from the app's UI yet by design: the office tick box is Session 5.

1. **Nothing changed for contractors.** Sign in as a contractor (pg.josef.contractor@…). Home, Requests, Jobs, Invoicing, Calendar, Help tabs all present; an offer still shows "Your price"; Invoicing still lists invoices. Header still says "Contractor portal".
2. **Make a test painter an employee** (SQL editor, test project only):
   `update public.contractors set employment_type = 'employee' where id = '<a test contractor id>';`
3. Sign in as that painter. Expect: header "Painter portal"; tabs are HOME · JOBS · CALENDAR · HELP (no Requests, no Invoicing); Jobs shows the honest empty state even if they hold a job.
4. Type `/portal/money` and `/portal/requests` into the address bar → 404 page, not a blank section.
5. Read-back that the guard is in the database, not the screen — as that painter's session (browser devtools, `supabase.from('booking_offers').select('*')`) → `[]`; `supabase.from('wo_surfaces').select('id')` on a job they hold → rows.
6. Flip the row back: `update public.contractors set employment_type = 'contractor' where id = …;` Reload → the contractor portal is back exactly as in step 1.
7. Settings row exists and is off: `select value from public.settings where key = 'employees_enabled';` → `{"enabled": false}`.
