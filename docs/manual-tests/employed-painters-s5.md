# Manual test — employed painters, Session 5 (expenses, settings, the tick box, the lead)

Needs `20270161` applied, and `employees_enabled` = `{"enabled": true}` on the test project.

1. **Contractors page.** Every row has an **Employee** tick box; the **Add painter** form has one too. Tick it on a contractor with an open offer → refused inline: "Can't change yet — … has an open offer or booking on WO-…". Withdraw the offer, tick again → "Marked as an employee"; the row loses its crew count.
2. Sign in as that painter → header **Painter portal**, tabs Home · Jobs · Expenses · Calendar · Help.
3. **Profile**: no Company details, no Where you get paid, no Ready-for-work card. The compliance card reads **Your tickets** with White card / Working at heights only. Upload one with an expiry; the home page reminds about the other.
4. **Expenses**: on a job, claim $140 with a receipt, category, **My own money** → "over $100 without a pre-approval" shows → send → "the office pays you back". Claim $12 with **Company card** → "job cost".
5. As staff, approve both from Payables → Costs. **Employee reimbursements — owed back** lists the $140 only. **Mark paid back** → gone; the painter's list shows it as **paid**. The $12 stays **approved** (nothing to pay). Neither is on any invoice.
6. Un-tick the Employee box → "Marked as a contractor"; the contractor's portal is back, and their profile reads **Not yet offerable** until insurance is uploaded and verified.
7. **Lead painter**: on a two-employee job, change the lead on the board. The customer's completion report (after sign-off) reads "Your painter: <new lead's first name>". The PC job page's **Crew** card lists both with their days.
8. A non-lead employee can claim an expense against the job and start the walkthrough (Mode A) from their phone.
