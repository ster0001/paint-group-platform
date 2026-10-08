---
feature: painter-messages
role: pc
title: Message a painter about a job, with photos, from the job page
summary: The Messages box on a job in PC Command — one conversation per painter on the job, text and photos both ways, a line under each of your messages saying whether the painter was texted, and a card on PC Command when a painter writes back that clears once you read it.
sources: app/components/wo/MessageThread.tsx, app/components/wo/messageActions.ts, app/pc/wo/[id]/page.tsx, app/pc/page.tsx, lib/workorder/messageModel.ts, lib/workorder/messagesLoad.ts, lib/crm/work-queue.ts, lib/contractor/notify.ts, lib/staff/notify.ts
---

## What this is for
When you need to tell a painter something about a job, or ask them something, write it in the job's **Messages** box instead of a text from your own phone. The message is kept with the job, the painter sees exactly which job it is about, and photos can go either way.

## Before you start
- The job needs a painter on it: the contractor it was offered or assigned to, or an employed painter on its crew. Until then the box says there is nobody to message.
- **How the painter is told:** Settings → Automations → **Message from the office** — on/off, Text / Email / Both, and the wording. It goes out within sending hours; outside them the text waits for them to open (and is dropped if the painter reads the message in the app first).
- **If you want an email or text when a painter writes:** Settings → Staff logins → your notifications → tick **Painter message**. Nobody is ticked to start with — the card on PC Command is always there either way.

## Steps
1. Open the job from PC Command. **Messages** sits near the top of the page, under the estimator's notes.
2. If more than one painter is on the job, pick whose conversation from the names along the top (Lead, Crew). Each painter has their own conversation — nothing you write to one is seen by another. A dot on a name means they have written something you haven't read.
3. Type your message in **Write to the painter about this job…**.
4. To add photos, press **📷 Add photos** and take or pick up to six. Each shows **Uploading…** and then **Ready**. Press **×** to take one off.
5. Press **Send**. The line under the box says what happened: **Texted and emailed to Josef**, **Outside sending hours — Josef is texted at Mon 8:00 am**, or **Not sent — Josef has no mobile or email on file**. The same line stays under your message on the page.
6. When a painter writes back, PC Command shows a card **"Josef replied on WO-1042 — 12 Test St, Thornbury"** with their words. Press **Read and reply**: it opens this box on that painter's conversation, and the card is gone once you have opened it. Replying clears it too.

## What the colours and labels mean
- **Your messages** sit on the right with a cyan edge; the painter's on the left.
- **Covered by the text that just went — one per 10 minutes** — you sent several messages quickly; the painter got one text for the lot, not one each. If they read the conversation in between, the next message texts them again.
- **Lead / Crew / Earlier** — the painter's place on the job. **Earlier** is a painter no longer on the job: their messages stay readable, but you can't write to them.
- The PC Command card turns red when a painter's message has waited unread into the next day.

## If something goes wrong
- **"Not sent — … has no mobile or email on file."** The message is still in their Messages box for when they next open the app. Add their mobile on the painter's page (Contractors) and send a short follow-up.
- **A photo says it can't upload.** Only photos go in a message (JPEG, PNG, WebP or HEIC, up to 25 MB). Check the signal and add it again.
- **"That painter isn't on this job any more."** They were released from the job; message whoever is on it now.

## Related
- `docs/help/painter-messages/contractor.md` — what a contractor sees.
- `docs/help/painter-messages/employee.md` — what an employed painter sees.
- `docs/help/automations/staff.md` — switching and wording every automatic message.
