# Manual test — Assistant guided mode (S4, 2 Sep 2026)

Two prerequisites, both already true on the C1 test stack; on production the second is yours:
1. Migrations 20261227 + 20261228 run (done on prod 2 Sep).
2. `ANTHROPIC_API_KEY` set in Vercel (already used by the plan reader). Without it `/api/agent/start` answers 503 "not available" — nothing breaks, the wizard still works.

## The flow (as a customer, private window)
1. Open `/estimate`. Under the page-1 heading: **"Rather chat it through? Start with the assistant →"**. Tap it.
2. You land on `/estimate/assist?c=…`. The first line is the disclosure ("You're chatting with Paint Group's assistant…"). The assistant asks the address.
3. Answer with the chips (or type). Order: address → home/trade → inside/outside → house → the four flags → storeys → timing → email → what we're painting → condition → damage → bedrooms. The estimate appears on the right after the bedrooms.
4. The room loop follows: size (Looks right / Not sure / type it), cupboards, "anything else", then the tightening questions (doors, windows, ceiling height, colours), then the doors & windows check, missed rooms, and a Confirm per room.
5. **No dollar figure appears in the chat until every room is confirmed** (R4). Then the range card shows and a CTA — "Accept estimate" (small, fully settled job) or "Confirm my price — book the visit".
6. Tap any tile on the right at any point; come back to the chat and it carries on from the tree as it now is.
7. "Fill it in instead" (top right) opens the plain editor on the same estimate; "Chat it instead" on the editor comes back.

## Hard stop
Outside job, "Built before 1970: Yes", paintwork "Peeling" → the reply is the lead-paint script verbatim from `agent_settings.hard_stop_scripts`, and the estimate goes to the visit tier.

## What to look for
- A wrong or refused answer is said back plainly ("Let's try that again…") — never a silent skip.
- "Talk to a person" replies that a person has been asked for (the real handoff lands in S7).
- Phone width: the Chat / My estimate tabs at the top switch panes.
