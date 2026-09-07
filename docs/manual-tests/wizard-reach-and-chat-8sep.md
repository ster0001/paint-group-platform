# Reach a person from any wizard page, and live chat — Tom, 8 Sep 2026

Branch `feat/wizard-reach-and-chat`. No migration (the chat tables and Realtime publication from the assistant build
already exist). Two things to know first: **the chat is a direct line to a person, not the AI assistant** (the
assistant model is not in this loop yet — flag if you want it answering first), and **browsers only play the chime
after the person has clicked something on the page** (any click, once per tab).

## 1. The help bar under every wizard page
Open /estimate as a visitor. Under the Continue button on EVERY page: *Rather talk to a person? Any time:*
**Book a site visit** · **Call us · <company phone>** · **Request a call back**.
- **Request a call back** → name + phone (+ email) → *Call me* → "one of us will call you shortly". On Today it is the
  session's *Reply to X — stuck at Property* card when the draft exists, else a *requested a call* card. The account
  is made from the phone (an email is attached only if it isn't a test address).
- **Book a site visit** → the real windows on offer (the same ones the end of the wizard offers) → pick → name +
  phone + email → *Book it* → "Booked — Tue 9 Sep, 9:00 am with Sam". A `visits` row in the Diary, the .ics invite
  to the email, the estimator's Google Calendar updated. Today raises NO "book visit" card for it (the draft note
  says "Booked: …"). "No open times online right now" → request a call back instead.
- **Call us** dials Settings → Company → phone.
The old "Stuck? Ask us to call you" strip is gone — the bar replaces it.

## 2. The chat bubble (bottom-left of the wizard)
Tap **Chat with us** → panel opens with a greeting → type → send. The first message asks for a person: a card on
Today (*X wants to talk to a person*) AND the dock on every staff screen (below). Outside support hours the panel
says so and names the next opening; the message still waits on Today. Minimise with — ; a reply that arrives while
minimised shows a red count on the bubble. A reload keeps the same thread (browser storage).

## 3. The staff dock (bottom-left of every staff screen)
Estimates, Projects, Payments, CRM, the builder — all of them. Nothing open = nothing shown. A customer line that
this browser hasn't seen → the dock **pops open**, the row is bold, and it **chimes** (🔔 on/off in the header;
remembered). Tap a row → the thread: *I'll take it* (claim), *Call*, *Record*, *Full page* (the CRM chat page),
*Sorted* (resolve), and a reply box — replying also claims. **—** minimises to a pill ("1 waiting") that stays put as
you move between screens. Seen state is per browser.

## Proven on C1
`e2e/customer-journey/reach-and-chat.spec.ts` 3/3: call back from page 1 with nothing answered; a real visit booked
from page 1 (visits row, source wizard); customer chat → dock pops on /estimates → claim → reply lands in the
customer's panel → minimise → still there on /invoices → the next customer line re-opens it. Unit:
`lib/crm/work-queue-wizard.test.ts` (the "Booked:" rule). Sound can't be asserted by a test — hear it live.
