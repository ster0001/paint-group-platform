# Manual test — a painter's detail page, and removing one (18 Sep 2026)

Needs `20270170` applied.

1. **Open a record.** Contractors → click any painter's **name**. Their page opens with mobile (tap to call), email, painters on their crew, tier, ABN, GST, address, weekends, bank, RCTI.
2. **Paperwork** card lists each document with its expiry and whether it has been checked, colour-coded Valid / expiring / Expired / Pending.
3. **Quality checks** shows the tally (passed, failed, total) and each check against the job it belongs to. The job name links to the job.
4. **Jobs** shows completed and total counts, every job with its dates, stage and (for a contractor) their price. Employed painters show "lead painter" where they lead.
5. **Remove, refused.** On a painter with jobs: **Remove this painter** → type DELETE → Remove permanently → refused, naming the job, and suggesting Suspend. Check the painter and the job are both untouched.
6. **Remove, allowed.** Invite a painter you do not want, or use a duplicate row with no history → Remove → it disappears and you land back on the list. Their login is left alone; without a contractors row they see "your account isn't set up yet".
7. **The button is guarded.** Remove permanently stays greyed out until DELETE is typed exactly, in capitals.
