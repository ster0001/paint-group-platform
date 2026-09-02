# Manual test — Assistant human handoff (S7, 2 Sep 2026)

## Migration + Settings
1. Run `supabase/migrations/20261230000000_agent_handoff_realtime.sql` — the final select lists `agent_conversations` and `agent_messages` (Realtime on).
2. In `agent_settings.support_hours` add who gets pinged (E.164):
   `"roster": {"mon": ["+61…"], "tue": ["+61…"], "default": ["+61…"]}, "escalateTo": ["+61…"]`. Hours are Mon–Fri 08:00–17:00 unless you change them; the SLA is `sla_claim_seconds` (180).

## In hours (two windows)
1. Customer (portal): estimate → Messages → Ask the assistant → **Talk to a person**. The assistant says a person has been asked for; the status line says "Waiting for a person".
2. Staff: CRM → Today → Messages: **"<name> is waiting for a person" → Claim**. The chat opens with the 3-line summary. Type a reply — it appears in the customer's chat within a couple of seconds, labelled Paint Group. The customer's replies appear in yours.
3. **Resolve** → the customer sees "They've stepped away — keep going or leave it here?" and the assistant answers again.
4. Not claimed within 3 minutes: the card goes overdue, the escalation numbers get a text, and the customer is offered a callback.

## After hours
Talk to a person → "We're closed just now — next available Mon 08:00 …" → **Request a callback** → morning/afternoon + mobile → "Booked — we'll call you <date>". Today shows the existing Callback card for that day.
