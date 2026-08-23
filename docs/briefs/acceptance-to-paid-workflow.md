# Acceptance → Paid — the G-phases workflow

**Status:** DRAFT v2 — awaiting Tom's approval. Supersedes the v1 draft (authored in an earlier session, never committed). Settle the 5 ⚑s below, then commit to `docs/briefs/acceptance-to-paid-workflow.md` — that commit unblocks Step 7 of the invoicing build (B1's gate).
**Owns:** the workflow semantics for the span from estimate acceptance to money in the bank — who does what, when the system speaks, and when it stays silent. Per the invoicing brief's closing rule: **this file wins on chase-ladder semantics; the brief wins on data model and build order.**
**Owners of the span:** PC + Admin. Nothing in this workflow auto-contacts a customer without a human approval in v1.

---

## The G-phases

Every job travels G0 → G7. Phases describe the *money* state; the WO loop's stages describe the *work* state. They run in parallel and meet at sign-off.

### G0 — Accepted
Customer accepts the estimate. The estimate snapshot freezes (the contract price), the job ledger opens, and the **deposit invoice auto-drafts** into the Payments tab (default 10%, amendable). The WO/scheduling flow starts independently.
**PC action:** review the deposit draft, amend if needed, issue and send.

### G1 — Deposit out
Deposit issued and sent with pay link + bank details. Due per payment terms (7 days default).
**System:** records sent/viewed events; card payment marks itself paid via Stripe; bank transfer recorded by staff.
**Gate (⚑5):** the job MAY be scheduled with the deposit unpaid, but an amber "deposit unpaid — starts in N days" card appears in the PC console (N = 3 default). Nothing blocks automatically.

### G2 — In progress / progress claims
Staff raise progress claims at their discretion — % of job or fixed amount — or skip straight to invoicing in full. Approved variations accrue on the ledger as they happen (they do not generate invoices by themselves; default is they fold into the final).
**PC action:** raise claims per job judgement; check the Costs tab as trade/material costs land.

### G3 — Sign-off → final invoice
WO sign-off (either mode, deemed included) auto-drafts the **final invoice**: adjusted contract minus previously invoiced, variations itemised with approval dates. The contractor's invoice auto-drafts at the same moment (their offer + accepted variation deltas), starting the 7-day contractor payment timer.
**PC action:** final-check the invoice document, issue and send — ideally same day as sign-off, while the finished job is fresh in the customer's mind.

### G4 — Due window (quiet)
From issue to due date the system is silent. Viewed events show on the dashboard; the invoice sits in "Awaiting". No reminders before due — the customer was just handed a finished job and a fair document.

### G5 — The chase ladder (⚑1–⚑3)
`overdue` derives automatically (due date passed ∧ balance owing). The daily sweep advances the ladder; **every rung produces a DRAFTED message for PC approval — nothing sends itself in v1** (⚑3 governs if/when that changes). Proposed rungs, all timings Settings values:

| Rung | When | What | Tone |
|---|---|---|---|
| 1 | due + 1 day | Draft friendly reminder (email) + dashboard flips to overdue | "A gentle reminder — your invoice fell due yesterday" |
| 2 | due + 4 days | Draft second reminder + **call task** card in PC console (tel: link) | Warm but direct; restates pay link + bank details |
| 3 | due + 7 days | Draft firm chaser + call card escalates to critical (clay) | States the amount, the days overdue, and asks for a payment date |
| 4 | due + 14 days | **Escalation card to Tom** — options: payment plan, formal demand, hold (dispute), write-off path | No template — this is a human conversation |

A recorded payment at any rung clears the ladder instantly. A partial payment resets the clock from the payment date (Settings toggle). Disputed invoices get a `hold` flag that pauses the ladder and shows amber on the dashboard.

### G6 — Escalation outcomes
From rung 4, Tom-only actions: agree a payment plan (recorded as scheduled expected payments — informational, not new invoices), issue a formal letter of demand (template ⚑4), or write off (reason required, event-logged, staff-gated until roles tighten). Nothing here is automated.

### G7 — Paid & closed
Balance reaches zero: job flips to Paid in full everywhere, receipt issued, the review-request task (from the WO loop) is confirmed sent, and the job's rows are eligible for the MYOB export. The ledger stays readable forever — this is the record the customer's portal paint-history will lean on later.

---

## Contractor payables (the mirror ladder)
Contractor invoice approved → 7-day timer → "due to pay" appears in the dashboard Payables tab → at due date it goes amber; 3 days past, clay. No messages are drafted to contractors — the ladder chases *us*, not them. Paying people on time is part of being the builder contractors queue up for.

---

## ⚑ The 5 open flags — Tom to rule before committing

| ⚑ | Decision | Default written above |
|---|---|---|
| 1 | Ladder rung timings (1 / 4 / 7 / 14 days after due) — and calendar vs business days | Calendar days, Settings-editable |
| 2 | Channels per rung — email only, or email + SMS from rung 2? (SMS needs the provider decision, invoicing ⚑16) | Email drafts now; SMS joins rung 2 when a provider exists |
| 3 | Draft-for-approval vs auto-send — does rung 1 ever earn auto-send after a bedding-in period? | Everything drafted in v1; revisit after one clean month, same pattern as daily updates |
| 4 | Rung-4 consequences — late fee? interest? letter-of-demand template? (Late fees on residential contracts need the same legal review as the deposit cap and deemed sign-off clause) | No fees in v1; escalation is human; demand template goes to legal review |
| 5 | Start-unpaid policy — confirm jobs may start with deposit unpaid (amber card only), and whether an overdue progress claim should ever pause work on site | Start allowed with amber card; work never auto-pauses — pausing is Tom's call, made on the escalation card |

---

## Approval
When the 5 ⚑s are ruled: mark this file **APPROVED**, note the rulings inline, commit to `docs/briefs/`, and tell the build session — Step 7 of the invoicing brief unblocks at that commit. Customer-facing copy throughout is ENGLISH (not Australian) tone; all timings and templates are Settings values so tuning never needs a rebuild.
