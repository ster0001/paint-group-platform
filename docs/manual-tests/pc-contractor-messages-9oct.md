# Manual test — messages between the office and a painter, per project (9 Oct 2026)

Needs migration `20270249000000_wo_painter_messages.sql` pasted on production
(check the ledger: `select * from public._prod_migrations where name like '20270249%';` — no row = not live).
Use a job whose painter is YOU on a second phone/login, or a painter who knows you are testing.

## 1. The office writes, with a photo
1. PC Command → open a running job → **Messages** (near the top, under the estimator's notes).
2. If the job has more than one painter, the names show along the top — pick one.
3. Type a message, press **📷 Add photos**, take or pick a photo. Wait for **Ready**.
4. Press **Send**. Expect your message on the right with the photo, and a line under it in words:
   **Texted and emailed to …**, **Outside sending hours — … is texted at …**, or **Not sent — … has no mobile or email on file**.
5. Send a second message straight away. Expect **Covered by the text that just went — one per 10 minutes**: the painter gets ONE text, not two.

## 2. The painter sees it, named by the project
1. On the painter's phone: the text reads **New message from Paint Group about <job ref>, <suburb>** with a link.
2. Tap it (or open the portal **Home**): the **Messages** card lists the job as **<job ref> · <suburb>** with **2 new**. No street, no customer name.
3. Tap the job: it opens the job page at **Messages**; tap the photo to see it full size.
4. Reply with a line and a photo from the camera → **Sent to the office.**
5. Back on Home the job shows **Read**.

## 3. PC Command gets the reply
1. PC Command → **Needs you now** shows **"<painter> replied on <job ref> — <address>"** with their words.
2. Press **Read and reply** → the job opens on that painter's conversation.
3. Go back to PC Command: the card is gone.
4. Optional email: Settings → Staff logins → tick **Painter message** for yourself; have the painter write again → one email (several messages within 10 minutes = one email).

## 4. A site check-in note goes the same way
1. On the job, **Site check-ins** → a visit → write a note, add a photo, tick **Send to the painter** → **Add note**.
2. The note's line reads **In the painter's messages since … Texted …** (or **Not delivered: …** with the reason).
3. **Messages** on the same job (that painter's conversation) shows the note as your message, with the photo.
4. The painter sees it in the same conversation on their phone; one text, not two (and none if you messaged them in the last 10 minutes and they haven't read it).

## 5. Nobody else sees it
1. Sign in as a different painter (not on the job): Home → Messages does not list the job; `/portal/jobs/<that job id>` is a 404.
2. Settings → Automations → **Message from the office** → switch off → send → the line says **Not texted — the “Message from the office” automation is switched off.** Switch it back on.
