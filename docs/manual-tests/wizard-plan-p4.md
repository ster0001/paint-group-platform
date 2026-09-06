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

## 2. Describe it = one request, straight into the editor (your ruling, 7 Sep)
On `/estimate` tap **Describe it**, type the job in one go (rooms, surfaces, condition, anything unusual),
tap **Continue** → your name, email and phone (still the last question) → **See my estimate**. A building
screen shows for 10–20 seconds and you land in the confirm-loop editor, not the chat. The estimate is
named by the street line, carries the address and contact, joins the customer record, converts the wizard
session (the status pills on Estimates → Wizard and the CRM buckets), and sends the "Your estimate is
saved" link that opens the editor. In the editor you will see: the rooms the paragraph
named, the range, the amber "to confirm" lines, and the "A few details to settle" card. The chat only
appears if the paragraph wasn't enough to build from (e.g. no rooms named). "Chat it through instead"
is still there under the box for people who want the back-and-forth.

## 3. The paragraph that failed on 6 Sep (chat path)
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

## Cupboards: the doors come first (Tom, 7 Sep)

1. Customer wizard → any bedroom card in the editor. The only cupboard question is "Paint the built-in robe doors?".
2. Tap **No** → no further cupboard questions appear; the "+ Inside the cupboards" sweep chip answers "Tick the cupboard doors Yes in a room first".
3. Tap **Yes** → two more questions appear under it: the walls inside the robe, and the inside of the robe doors. Answer Yes to both → two extra lines price in.
4. Flip the doors back to **No** → both inside lines disappear from the price and both follow-up questions go; flip to **Yes** again and they come back unanswered.
5. Kitchen/bathroom/laundry follow the same rule for "inside the cupboards".

## 7 Sep evening batch (Tom)

- **No heritage question on page 1.** Customer wizard → property page: suburb, postcode, job, property type, then the way in. Continue never asks for heritage.
- **Price on the estimates list.** Finish a customer wizard run (form or describe) → Estimates list shows the total straight away; each edit in the customer editor keeps it current.
- **Rename a room.** Customer editor → a room card → ✎ next to × → type "Nursery" → Save → the card, the toast and the price line update.
- **Chat widget.** Customer editor (and every portal page): "💬 Chat with us" bottom-right → the assistant's support disclosure, ask "What's included?" → grounded answer; "Talk to a person" → status line says waiting for a person; a callback can be requested. No "Inside, outside or both?" interview, no co-work.
- **Plastering from the builder.** /quote → an area → + Add Surface → folder "Plastering & sealing (hours)" → Plastering → a line with 1 prep hour and a crew note field; the price moves by one charge-out hour.
- **Allowances out of Materials.** An estimate with a Ceilings Only / Colour Match allowance: the Materials card at the top of the builder lists no row for them.
