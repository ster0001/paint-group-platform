---
feature: painter-messages
role: employee
title: Read and answer messages from the office about a job — with photos
summary: Messages from the office about a job you are on land in Messages on your Home screen (job number and suburb) and on the job's page, where you can reply with text and photos from your phone.
sources: app/components/wo/MessageThread.tsx, app/components/wo/messageActions.ts, app/portal/page.tsx, app/portal/jobs/[id]/page.tsx, lib/workorder/messagesLoad.ts
---

## What this is for
The office can write to you about any job you are assigned to — a change to the day, something to check, a question. You answer on the same job, and can send photos back.

## Before you start
- Keep your **mobile** up to date in **Profile**: when the office writes, you get a text "New message from Paint Group about WO-1042, Thornbury" with a link to the job.
- Each painter on a job has their own conversation with the office. What you write is seen by the office, not by the rest of the crew.

## Steps
1. Tap the link in the text, or open **Home**. The **Messages** card lists each job with messages: the job number and suburb, the last line, and **1 new** when there is something you haven't read.
2. Tap a job. It opens the job page at its **Messages** box.
3. Read the office's message. Tap a photo to see it full size.
4. To reply, type in **Write to the office about this job…**.
5. To send photos, tap **📷 Add photos** and take them or pick them from your photos (up to six). Wait for each to say **Ready**.
6. Tap **Send**. It says **Sent to the office.**

## What the colours and labels mean
- **1 new** (amber) — the office has written since you last opened that job's messages.
- **Read** — you are up to date.

## If something goes wrong
- **A photo won't upload.** Only photos can go in a message. Check your signal and add it again.
- **"That job isn't yours."** You have been taken off that job, so its messages are closed to you. Ring the office.

## Related
- `docs/help/work-orders/employee.md` — running an assigned job.
