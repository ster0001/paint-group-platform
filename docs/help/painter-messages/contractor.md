---
feature: painter-messages
role: contractor
title: Read and answer messages from the office about a job — with photos
summary: Messages from the office land in Messages on your Home screen, one line per job (job number and suburb), and on that job's page, where you can reply with text and photos from your phone.
sources: app/components/wo/MessageThread.tsx, app/components/wo/messageActions.ts, app/portal/page.tsx, app/portal/jobs/[id]/page.tsx, lib/workorder/messagesLoad.ts
---

## What this is for
When the office needs to tell you something about one of your jobs, or ask you something, it comes as a message on that job. You can answer the same way, and send photos back — a problem you have found, the finished wall, a question about a surface.

## Before you start
- Keep your **mobile** up to date in **Profile**: when the office writes, you get a text "New message from Paint Group about WO-1042, Thornbury" with a link to the job. If the office has chosen email as well, the email has the message in it too.
- You only see messages about jobs you are on. Each conversation is between you and the office — nobody else on the job reads it.

## Steps
1. Tap the link in the text, or open **Home**. The **Messages** card lists each job with messages: the job number and suburb, the last line, and **1 new** when there is something you haven't read.
2. Tap a job. It opens the job page at its **Messages** box.
3. Read the office's message — including any notes from a visit to the site, which arrive here too. Tap a photo to see it full size.
4. To reply, type in **Write to the office about this job…**.
5. To send photos, tap **📷 Add photos** and take them or pick them from your photos (up to six). Wait for each to say **Ready**. Tap **×** to take one off.
6. Tap **Send**. It says **Sent to the office.** and your message appears on the right.

## What the colours and labels mean
- **1 new** (amber) — the office has written since you last opened that job's messages.
- **Read** — you are up to date.
- **Your messages** sit on the right; the office's on the left, with the name of whoever wrote.

## If something goes wrong
- **A photo won't upload.** Only photos can go in a message (not videos — use the job's photo steps for those). Check your signal and add it again; very large photos are shrunk on your phone first.
- **"That job isn't yours."** You are no longer on that job, so its messages are closed to you. Ring the office.
- **No text arrived.** Check your mobile in Profile. Messages are always on the job page and on Home, text or no text.

## Related
- `docs/help/work-orders/contractor.md` — running the job itself.
