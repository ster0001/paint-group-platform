---
feature: work-orders
role: employee
title: Run a job from the first tick to the customer's signature
summary: How an assigned job works on your phone as an employed painter — the pre-start list, before photos in one batch, ticking surfaces off, after photos of every room or side, the finishing-up list, the quality check and the walkthrough — the same as every painter, with no money on it.
sources: app/portal/jobs, app/components/wo, app/s, lib/workorder, lib/contractor/employeeJobs.ts
verified_at_commit: 3a6848a2fd
---

## What this is for
Once you have tapped **Accept** on an assigned job, the job page in **Jobs** is where the work is recorded. You tick each surface as you prep and finish it, photograph before and after, raise anything you find that is outside the job sheet, answer the finishing-up questions, and at the end hand the phone to the customer to sign. The office and the customer see progress from what you tick. Everything here is identical to a contractor's job, except that nothing on an employee's job sheet carries a price.

## Before you start
- The job is on your **Jobs** tab with your days and a time budget — see [Your assigned jobs](../scheduling/employee.md). Tap **Accept** first so the office knows you have seen it.
- The office works through the **pre-start list**: colours confirmed, materials ordered and so on. Your job page shows how many items are still to be ticked by the office. The **Start the job** button unlocks when that list is done.
- Photos are taken with your phone's camera from the job page. A big photo is shrunk on your phone before it goes, so it is quick even on one bar of signal. While it goes the button shows a percentage; a photo that does not upload says why ("stalled — nothing moved for 45 seconds", "sign out and back in") and can be retried. Nothing sits on "Uploading…" for ever.
- If several painters share the job, every one of you can tick, photograph and raise a variation. Progress is the job's, not yours alone.

## Steps

### Starting the job
1. Open **Jobs** and tap the job. Under **You're on this job**, **Ready to start?** shows how many pre-start items the office still has to tick. When the list is done, tap **Start the job** on your first morning on site. The job moves to **In progress** and the office sees you are there.

### Ticking surfaces off
2. **Scope & ticks** lists every area on the job sheet and its surfaces. Each row has three squares: to do, prepped, done. Tap a row once to mark it **PREPPED**, again to mark it **DONE**. The count at the top is the job's live progress.
3. **Step 1 · Upload the before photos.** The job runs in four numbered steps. Until the job has its before photos the scope list is locked and says so. On the **Step 1** card tap the green **Upload photos** button and pick every before photo at once, camera or library; they upload the moment you choose them, with a count. Take photos of all rooms or all sides. Whoever on the crew uploads them, the moment they land every row on the job unlocks.
4. Now tick. The row turns cyan **PREPPED** on the first tap and green **DONE** on the second. Your ticks are recorded under your name, and the office's daily update to the customer is drafted from them.
5. **Step 3 · Upload the after photos.** When every surface is **DONE** the Step 3 card appears: tap the green **Upload photos** button for photos of all rooms or all sides now the work is finished. The job asks once, not per area, and Step 4 stays locked until they are in.

### Photos from the office
Near the top of the job sheet, above the scope, a **From the office** section holds photos the office has attached for this job — the elevation the scaffold goes on, where the gear lives, the colour to match. Each says which area it belongs to (or **Whole job**) and what to notice. Tap one to see it full size.

On a job that came in from PaintScout these are often the only photos there are, so check them before you start. They can be added after the job is booked, so look again on the morning. They are separate from the photos you take, which stay under **Site photos**.

### Photos and notes from site
6. **Got a question, or found something?** is the card under the steps, for questions only: a photo of an item you are unsure about and a short note for the office. Before and after photos go in Step 1 and Step 3, not here.

### Found something? Raise a variation
7. Rot, damage, extra scope, or something the customer asked for on the day: raise it from the job with a category, a note and a photo. The office prices it and the customer approves it. When it is approved you will see **Variation approved** on the job with the added scope and hours so the work can go ahead; if it is not, **Not going ahead** with the office's note. There is no price on it and nothing for you to accept.
8. Changes the office agrees with the customer after the job was issued also appear on your job sheet under **Changes to the scope** — **Added** with the hours, or **Removed** — so the sheet is never behind what the customer has signed. Approved work is on your tick list too: a new area under its own heading, a variation you raised under **Variations**. Tick it like any other row.

### Finishing up
8. When every surface is done, the **finishing-up list** appears on the same screen: rubbish, equipment for collection, a note for the customer. Answer it and tap **Finish**. The job routes itself to the quality check or the walkthrough — nothing customer-facing for you to press.

### The quality check
9. If the office has scheduled a quality check, the job waits at **Quality check** and the page says so. If areas come back to put right, they are listed on the job with the inspector's notes and photos and reappear on your tick list; tick each one off once it is done and the check runs again.

### Walkthrough and sign-off on your phone
10. At **Walkthrough**, the lead painter's page carries **Start the walkthrough**. Any painter on the job can run it: walk the customer through each area, they approve or mark anything to fix, and sign on your phone. The job closes and the page reads **Job complete**.

## How long were you on site (when asked)
If the office has switched it on for you, the **All surfaces done** card asks for your days on site and hours in total before the job moves on. Change the pre-filled numbers to what actually happened, or tick **Skip** to use the booked days. It is for the office's hours-versus-estimate figures and changes nothing about your pay.

## What the colours and labels mean
- **🔒 Locked until Step 1** — the scope cannot be ticked until the job's before photos are uploaded.
- **Cyan PREPPED / green DONE** — a surface's live state, shared by everyone on the job.
- **Quality check** notice — the office is checking; the walkthrough opens when it passes.
- **Job complete** — signed off and closed.

## If something goes wrong
- **Start the job is greyed out.** The office still has pre-start items to tick — the number is on the button's card. Ring them if you are already on site.
- **The card says the office has not set the pre-start list up yet.** The list is missing on this job rather than unfinished. Nothing you can do from here — ring the office, especially if you are due on site.
- **A tick is refused with "Step 1 first".** Upload the job's before photos on the Step 1 card; the rule is the server's, not the screen's.
- **The job page has gone.** You have been taken off the job, or it has closed. Your ticks stay on the record either way.

## Related
- [Your assigned jobs, accepting one, and your calendar](../scheduling/employee.md)
