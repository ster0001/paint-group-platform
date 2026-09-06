---
feature: work-orders
role: pc
title: Run jobs through the six stages from the PC console
summary: The project coordinator's console — the attention queue and what its colours mean, the six lanes, the pre-start list, pricing and releasing variations, approving drafted customer updates, quality checks, the walkthrough and sign-off gates, and closing.
walkthrough: media/pc-walkthrough.gif
sources: app/pc, app/components/wo, lib/workorder
verified_at_commit: 931d769016
---

## What this is for
The PC console (**Projects** in the sidebar) reads every open work order and tells you what needs a person. Jobs move through six stages: **01 Offer → 02 Pre-start → 03 In progress → 04 Quality check → 05 Walkthrough → 06 Closed — final invoice sent**. Nothing moves by typing a status: each move has a gate, and the console shows you the gate that is holding a job. Your work is the pre-start list, pricing variations, approving the customer updates drafted from the painter's ticks, quality checks, and the sign-off.

## Before you start
- A job appears in the console once its estimate is accepted and the work order issued. Booking it is done on the **Schedule** tab (see the scheduling guide).
- Colours must be confirmed on the job sheet before materials can be ordered, and the pre-start list must be true before a job can start. The console tells you both.
- The customer's variation approval is by signature on a link you send them; the painter never sees the customer's price.

## Steps

### Reading the console
1. Open **Projects**. The **Dashboard** shows four tiles: **ON THE BOOKS**, **CRITICAL** (SLA breach, silent site), **WAITING ON YOU** (price, colours, nudge, drafts) and **SIGNED OFF THIS WEEK**. Below them, **Needs you now** is the queue, ranked worst first. Each card names the job, says what is wrong and offers one action, for example **Open**, **Ring them**, **Price it**, **Review**. The cross dismisses a card you have dealt with outside the system.
   ![](media/pc-01.png)
2. **Project progress** shows the six lanes with every open job as a card: reference, contractor, contract value and tick progress, plus **COLOURS TBC**, **WAITING** or **BLOCKED** where a gate is holding it.
   ![](media/pc-02.png)
3. Open a job. The header carries the stage rail, the money line (contract inc GST, variations, contractor pay, estimated GP, deposit) and the view switch: **PC view**, **Painter's view** (the same tick list the painter sees, which you can tick on their behalf), **Edit job sheet**, **Revise scope**, **Money view**.
   ![](media/pc-03.png)

### Pre-start
4. Scroll to the **Pre-start** card (the counter reads **N TO GO**, then **ALL DONE**). Answer **Colour schedule finalised** with **Yes**, or **No** if any colour still needs a colour match, then tick **Materials ordered** (it needs the colours first), **Equipment movements booked** and **Access details recorded**. **Pre-start checklist** and **SWMS / induction attached** are optional on a residential job; ticking the first emails the customer the pre-start checklist, and the second is required on commercial and body corporate jobs. An item that ticks itself is marked **auto**.
   ![](media/pc-04.png)
5. When the card reads **ALL DONE** the job can start. Further down, under the job facts, tick **Quality check required** if this job needs a check regardless of the contractor's record (a new contractor's first three jobs get one automatically); **Add a mid-job check** schedules an extra one for a date you choose.
   ![](media/pc-05.png)
6. **Next step** offers **Start the job** once the list is true, with the gate's wording underneath while it is not. You can start early; the console warns that starting moves the start date to today and asks you to press again. Otherwise the job starts itself on its booked date once the list is done.
   ![](media/pc-06.png)
7. At **03 In progress** the **Scope & ticks** card shows the painter's list live, with the amber before-photo prompts until each area has its photo.
   ![](media/pc-07.png)

### Pricing a variation
8. A raised variation appears on the job as a card with a five-step rail: **RAISED → PRICED → CUSTOMER → CONTRACTOR → WORK**, the painter's words, their photo and their hours estimate. It also lands in the queue as **Variation waiting on a price**. Choose **Price it in the builder — working scope** for anything with materials or several lines, **Quick price — hours only** for a small labour-only item, or **Approve for the contractor only — no charge to the client** when Paint Group is absorbing it.
   ![](media/pc-08.png)
9. Quick price: enter the hours and any materials. The preview shows the customer price from the pricing engine and the contractor's amount.
   ![](media/pc-09.png)
10. Priced, the card reads "with the customer" with the amount, and the signing link has been emailed. **Text the link** or **Both** if the customer prefers. **Set contractor amount** overrides what the painter receives. The queue card **Variation priced, customer silent** appears if they do not answer.
    ![](media/pc-10.png)
11. The customer approves by signing the link. Under **Settings → Automations**, "Approved variations go straight to the painter" is on by default, so the painter sees it as **YOUR APPROVAL** straight away and accepts; the rail reaches **CONTRACTOR** then **WORK**. If that automation is off, a **Release** step appears here for you. A removal signed after work started raises **Pay adjustment needs you**: enter the deduction and why; the painter sees your note.

### Customer updates from the painter's ticks
12. Each day's ticks and photos become a drafted customer update. **Updates** lists **Updates waiting on you**; read it, edit if needed, then **Approve & send**. Nothing goes to the customer until a person approves it. On the job page, **Send the customer an update** comes pre-written from the latest ticks with the site photos ready to attach; edit the words and tap **Send update — email & text**.
    ![](media/pc-11.png)

### Quality check
13. When the painter taps **All done — next step**, the server routes the job: to **04 Quality check** if a check is due, otherwise straight to the walkthrough. Checks are due on a new contractor's first three jobs, on any job where you ticked **Quality check required**, and for any mid-job check you added. The check appears on the job as a **Quality check** card ("Photo-logged against the standards. Every line looked at before a pass.") with the four standards: **Cut lines**, **Coverage**, **Prep evidence**, **Site**. The queue says **Quality check to do**. Tick each standard as you inspect it; the pass button reads **N standards to check** until all are ticked.
    ![](media/pc-12.png)
14. To fail it, tap **Log fail**, enter **Where** (the area) and what needs putting right, add **Photos of where it failed — show the painter**, and tap **Log fail — raise rectification**. The check is logged **FAIL**, the job returns to **03 In progress**, and the item lands on the painter's tick list marked **Rectify** under the area you named. The failed card stays on the page as the record — **Logged: FAIL · re-check scheduled** — and Job facts lists the re-check as **due**.
    ![](media/pc-13.png)
15. When the painter has put it right and finished again, the job comes back to **04 Quality check** with two cards: the failed check, still **Logged: FAIL** with no buttons, and a fresh **Quality check re-check** card with all four standards unticked. Work the re-check card: tick each standard as you inspect the fix; when every one is ticked it reads **READY TO LOG**; add a note and tap **Log check — PASS**. (**Add a mid-job check** is for an extra inspection, not for this — the re-check is scheduled by the fail itself.)
    ![](media/pc-14.png)
16. A pass with no other check open moves the job on by itself: the customer's evidence pack is delivered and the stage becomes **05 Walkthrough**. The pack cannot go while any check is unpassed. A logged FAIL counts as open only until its re-check exists; once the re-check passes, the fail is history and holds nothing. If the re-check fails too, the same thing happens again — a further re-check, as many times as it takes.

### Walkthrough and sign-off
17. At **05 Walkthrough** the **Next step** card offers **Move to closed — final invoice sent**, which is the office closing the job on the customer's behalf; the normal path is the customer signing on the painter's phone. The **Walkthrough** card shows the estimated finish and the booked **FINAL** walkthrough with **Missed** and **Cancel**; pick a date and time and **Rebook final** to change it (an empty date lands on the last day on site), or **Book pre** for a pre-walkthrough. Ticking **Walkthrough not required** closes the job at the invoice stage once it is finished and checked. Under **Sign-off from our side**, **Walk through on this device** runs the customer's walkthrough on your own screen when you are with them, and **Record sign-off manually** records an approval they gave by phone or on paper, with their full name and how they approved. **Customer can't attend — open remote sign-off** is the gate for the remote path: only open it when the customer genuinely cannot be there; it sends them their own signing link.
    ![](media/pc-15.png)
    ![](media/pc-16.png)
18. The sign-off clock sends the customer reminders at the intervals set under Settings, and the queue shows **Sign-off clock at 48 hours** when it has run that long. Deemed execution is switched off: a job waits at Walkthrough until a person signs, however long the clock runs. An **Extension requested on sign-off** card asks you to approve or decline.
19. A flagged area returns the job to **03 In progress** with the area on the painter's list; the walkthrough runs again once it is fixed.

### Closed
20. Signing closes the job: **06 Closed — final invoice sent**, the **Next step** card reads "This job is finished and signed off", and the header gains **Final invoice (draft)**. The final invoice, warranty and completion report are created in that one step. **Something found after sign-off — reopen** takes the job back to Walkthrough for the customer to sign again; it asks for a reason.
    ![](media/pc-17.png)
    ![](media/pc-18.png)

## What the colours and labels mean
- **Amber** — waiting on a decision, usually yours: **WAITING**, **COLOURS TBC**, a queue card with an amber bar, a variation at **RAISED** or **PRICED**.
- **Clay (red)** — overdue or breached: **CRITICAL** tile, **Offer unanswered past SLA**, **Nothing ticked in N days**, an overdue decision.
- **Cyan** — live or informational: the current stage on the rail, **Customer update due**, drafted updates.
- **Emerald (green)** — done: completed stages on the rail, a passed check, **SIGNED OFF THIS WEEK**.
- Lane names are the stage names: **01 Offer, 02 Pre-start, 03 In progress, 04 Quality check, 05 Walkthrough, 06 Closed — final invoice sent**. There is no separate completion-prep lane; the painter's finishing-up list is part of In progress.
- Variation rail: **RAISED → PRICED → CUSTOMER → CONTRACTOR → WORK**.

## If something goes wrong
- **"The pre-start list has to be true before a job can start."** An item is unticked or a question unanswered; colours must be ticked before materials.
- **"1 variation still waiting on a decision."** The painter cannot finish while a variation is unpriced, unsigned or unaccepted. Price it, chase the customer's signature, or approve it for the contractor only.
- **"Every surface has to be ticked off first."** The painter has rows not yet Done. Check **Scope & ticks**, or tick on their behalf from **Painter's view** if you have confirmed the work on site.
- **"N quality checks still open."** Log every scheduled check as a pass before the pack can go. A logged **FAIL** is not what is holding it: the fail schedules its own re-check, and it is the re-check (or a mid-job check you added) that is still unlogged. The card with the standards is the one to work. If the job is at Quality check and the only card reads Logged: FAIL, the painter has not finished again yet — the re-check card appears when they tap **All done — next step**.
- **A job sits at Quality check with no card.** No check was due; use **All done — next step** to route it on.
- **The painter says they cannot tick.** Their area has no before photo yet, or the job is not at In progress.
- **The customer never received the variation link.** Check the contact's email and phone on the estimate, then **Text the link** or **Both**.

## Related
- [Offer a job to a painter and manage the booking](../scheduling/staff.md)
- [Approve and pay contractor invoices](../self-invoicing/staff.md)
