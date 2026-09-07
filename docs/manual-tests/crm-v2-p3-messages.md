# Manual test · CRM v2 Phase 3 — the messaging spine

Branch `feat/crm-v2-p3-messaging`. Source: `docs/briefs/crm-v2-deep-dive.md` §3 F3, §4.2.
Automated: `e2e/crm-p3-messages.spec.ts` (6 journeys, green on C1 7 Sep 2026), `lib/messaging/record.test.ts`,
`lib/crm/work-queue.test.ts` (message items).

## Migration to paste (one file, idempotent, read-back at the end)

`20270124000000_crm_messages.sql` — the `messages` table, its timeline trigger (`message_in` /
`message_out` events), the facts trigger learning them, `crm_mark_messages_read`, `crm_attach_message`,
and the portal thread (`estimate_messages`) mirrored in by trigger and backfilled.
Expect ONE row: `messages` ≥ `portal_mirrored`, `policies` 1, `triggers_ok` true, `functions_ok` true.

## Env to set on Vercel (in this order; each is safe alone)

| Var | What it turns on | Without it |
|---|---|---|
| `RESEND_WEBHOOK_SECRET` | delivery / open / click / bounce / complaint events at `/api/webhooks/resend` (add the webhook in BOTH Resend accounts, pointed at that URL, all `email.*` events) | outbound rows stay at "sent" |
| `REPLY_DOMAIN` (e.g. `reply.paintgroup.com.au`) | every outbound email carries `Reply-To: reply+<token>@…` so a customer's reply routes to its thread | replies go to the company mailbox as today |
| `MESSAGES_INBOUND_SECRET` | the signed inbound route `/api/inbound/messages` (Resend → Receiving → add the reply domain, MX record per Resend's instructions, webhook `email.received` → that URL) | inbound email is not captured |

Set `REPLY_DOMAIN` only AFTER the receiving domain verifies in Resend, or replies will bounce.
Twilio: nothing to set — delivery receipts arrive at `/api/sms/status` automatically once the site URL is https.

## Walk

1. **Send anything** — an estimate, an invoice, a progress update, a campaign, a reply from the record.
   The customer's record → Messages shows the row with subject, body, "to …", and a status that moves
   (sent → delivered → opened) as Resend reports.
2. **A reply by email** (with the reply domain live) — appears on the record within seconds as "They
   wrote", marked unread (amber), and Today → Messages shows "<name> sent a email" until someone replies
   from the record or logs a call. Opening the record marks it read.
3. **A text from a customer** — same, via the existing Twilio inbound route. STOP/START/HELP still work
   exactly as before; every text is now also a row.
4. **An unknown sender** — Today shows "A text/email from <address> · not matched to a customer yet" with
   an Attach button → a page with the message and a customer search → attach → the message joins the
   record and the address is added as a contact on it.
5. **Reply from the record** — Messages → Email or Text → write → Send. Recorded whatever happens: sent,
   delivered later, or "not sent — channel not configured" / "failed" in red.
6. **The log sheet** — a logged call, email or text is now also a message row (provider "manual").
7. **A hard bounce** marks the customer undeliverable; a spam complaint unsubscribes them — the guard
   chain reads both.

## Traps found building it

- Reply tokens are base64url: case-sensitive. Match case-insensitively on the mailbox, never lowercase
  the token.
- Resend's inbound webhook carries no body; `fetchReceivedEmailBody` hydrates it (needs `RESEND_API_KEY`).
- The generic "every message is an event" trigger must not fire for unmatched rows — the attach RPC
  writes the event when a person matches it.
- Work-item buckets are Melbourne DAYS: a message due two hours ago is "today", not "overdue".
- C1 holds Twilio test keys the API refuses → a send records "failed"; that is the honest record.
