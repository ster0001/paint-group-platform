---
feature: website-chat
role: staff
title: What the website chat asks for, and where the details land
summary: The website and online-estimate chat asks a visitor for name, email and mobile after their first message when we have none on file (in the closed reply out of hours); the details file or find their account, link the chat to it, add a "Left their name, email and mobile" note to their timeline, and count once as a lead in Tag Manager.
---

## What this is for
A website visitor who chats and then leaves used to leave nothing to ring back. Now the chat asks for their details, so every chat has a person behind it.

## Before you start
Nothing to set up. The wording is fixed in the code (`lib/agent/handoff.ts`).

## Steps
1. A visitor sends their first message. If the account behind their browser has no email and mobile, the chat asks for them, once, while it finds a person. Out of hours the closed reply asks instead: *We're closed just now — a person is next available … Leave your name, email and mobile and we'll come back to you as soon as we open.*
2. They fill in the three boxes in the chat, or type an email and an Australian number into a message.
3. The chat thanks them. Their account is found or made by email or mobile, the conversation is linked to it, and their timeline shows *Left their name, email and mobile in the website chat*.
4. Answer the chat from the dock as usual. Out of hours, the request waits on Today with the account attached, so you can ring them.

## What the colours and labels mean
- A chat from someone whose email and mobile are already on file is never asked, and never counted as a new lead.

## If something goes wrong
- **They typed a number but the chat asked again.** Typed details only count when the message has both an email and a number. A number alone is just a message.
- **Lead counts in Google or Meta look low.** The lead counts only for visitors who pressed **Allow analytics**, and only once per mobile per browser (see `success-urls/staff`).

## Related
- `success-urls/staff`
- `crm/staff`
