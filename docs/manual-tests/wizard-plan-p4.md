# Estimator plan — Phase 4 · the assistant, first fixes · manual test for Tom (7 Sep 2026)

Branch `feat/wizard-plan-p2` (same PR as Phase 2/3). Needs the real model, so test on production
as staff (staff preview of `/estimate` → Describe it → "Rather chat it through?").

## 1. Model tier and the token budget — one SQL statement on prod (do this FIRST)

The chat said "I've reached my limit" after three questions on 7 Sep because the per-conversation
budget in the database is 60,000 tokens, and one paragraph turn (up to eight tool rounds) spends
more than that. The code defaults are now 400,000 per conversation and 2,000,000 per account per
day, but the seeded row wins, so:

```sql
update public.agent_settings
   set model_default = 'claude-sonnet-5',
       budget_tokens_per_conversation = 400000,
       daily_cap_per_account = 2000000;
```

`model_heavy` is already `claude-sonnet-5`. Cost shows on `/admin/agent` per completed estimate.

## 2. The paragraph that failed on 6 Sep
Open the chat and type, as one message:
> Hi, it's 14 Murrumbeena Rd, Murrumbeena 3163. It's my own home, a 3 bed single storey weatherboard.
> We want the whole inside repainted, new colours, and the kitchen cupboards painted too. Roughly what would that cost?

Expected now: the reply records the address, home, inside, house/storeys (you can see the answers
land in the transcript's next questions — it must NOT re-ask the address, inside/outside or storeys),
says in one line what it still needs for a range (rooms/surfaces), and asks ONE next question. It must
not mention being closed, opening hours or a callback (unless you ask for a person).

## 3. Free-text address on its own
Type just `9 Elm Street Bentleigh VIC 3204` → accepted (no "I need at least the suburb or postcode").

## 4. Asking for a person out of hours
Type "can I talk to someone?" on a Sunday → the closed line with the next opening and a callback offer,
once. Any other message out of hours never mentions hours.

## Still open (next pieces)
- Streaming replies (first reply under 5 s on a phone; today the whole turn returns at once).
- A weekly real-model eval: the paragraph above as a regression case with the expected recorded facts.
- The "Ask" bar on every wizard page / editor (support mode inside the estimate).
