# Office alerts: estimate declined / expired — manual test (1 Oct 2026)

Branch `feat/office-estimate-declined-expired-alerts`. No migration.

1. Settings → Automations → **Staff**. Two new rows: **Estimate declined by the customer** and **Estimate expired without an answer**, both on. Open each row's wording and check the preview reads with Sarah Chen / 12 Elm Grove, no raw `{{tokens}}`.
2. In the routing table under Staff logins, two new columns **Declined** and **Expired**. Tick **Email** on your own row for both and **Save**.
3. Send yourself a test estimate (any small one). Open its customer link in a private window, scroll to the accept panel, **Politely decline**, pick **Price**, type a note, **Decline estimate**.
4. Within a minute you receive **Estimate declined — <name> · <job>** with the reason line and an **Open the estimate** link that lands on the builder.
5. Decline it again from another device / reload: no second email (once per estimate).
6. Send another test estimate and set its **valid until** to yesterday. Wait for the daily CRM sweep (or ask whoever runs the platform to trigger `/api/cron/crm-sweep`). The estimate shows **Expired** in the list, appears under CRM follow-ups, and you receive **Estimate expired — <name> · <job>** naming the valid-until date.
7. Untick a column and repeat step 3 on a fresh estimate: no email to you; anyone else ticked still gets it.
