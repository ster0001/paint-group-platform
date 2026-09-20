# Manual test — the live-progress phone on the customer estimate

Branch `feat/estimate-live-progress`; the card version (Tom, 20 Sep) on `feat/live-progress-details-tab`. **No migration.** Brief: `docs/briefs/claude-code-brief-estimate-live-progress-v4.md`. Mockup: `design/reference/estimate-live-progress-mockup-v4.html`.

A test-stack walk can be seeded with `node scripts/c1/seed-live-progress.mjs` (prints two `/e/` links; `--remove` cleans up).

---

## 1 · With a presentation: the card, then the phone

1. Open a **sent** estimate that has a presentation ticked, as the customer: `/e/<token>`.
2. In the presentation's capability panel near the top (**A few extra details** on the live presentations) there is one extra card, glowing cyan: **📱 Receive live on-the-job updates as your job progresses · Click here to see a demo of your live updates · ▶ Show me the demo**. Nothing else on the page pulses. No phone yet, no hero button, no link in step 4.
2b. Press the card. The glow stops, the button reads **▲ Hide the demo**, and a section opens under the cards, full width, with only: the label **Example of your live updates**, a phone, **↻ Play again**, and a line starting **For illustration only**. No headline, no paragraph, no bullets. Press the card again: it closes.
3. With it open, within a second a text slides onto the lock screen: **Good morning &lt;first name&gt;. The team have arrived at &lt;street&gt;.** (With a Demo painter set: **Good morning Ben. Jacob and the team have arrived…**)
4. The text is tapped, the job opens: the street in the header, the suburb and "for &lt;full name&gt;" under it, **In progress**, Day 1, a lead-painter card.
5. Five updates rise one by one, roughly every 3 seconds. Day 1 names the first rooms on the estimate; Day 3 names the ceiling product; Day 5 the wall product. Photos are the estimate's own "as we saw it" photos, tagged **Before · your photo**, at most two per update, none repeated.
6. After the last update the pill turns **Ready for walkthrough** and the finished text appears: **&lt;first name&gt;, &lt;street&gt; is finished. Your walkthrough is at 2pm today.**
7. It holds about 6 seconds, then loops. Scroll it off screen, scroll back: it starts from the lock screen. Switch tabs and back: same.
8. **↻ Play again** restarts from the lock screen.
9. The hero has only **Accept estimate** and **Ask a question**; step 4 of **What happens when you accept** has no link. The card is the only way in.
10. **Download estimate (PDF)** / print preview: the section is absent.
11. Accept the estimate exactly as before. It accepts.

## 2 · Without a presentation

Open a sent estimate with no presentation. No card, no section. Scope of works runs straight into The paint we're supplying.

## 3 · Trade account

Link the estimate's customer to an account whose type is **trade**, with a PO on the property, and re-open the link:
- First text: **&lt;street&gt; (PO &lt;number&gt;): Paint Group signed in on site at 6:30am.**
- Header: the organisation's name top right; **&lt;suburb&gt; · PO … · Owner ref …** (only the references that exist).
- A five-step rail Pre-start → Closed; chips Certificate of currency / SWMS / Daily reports; **Site supervisor** on the person card.
- Updates: site induction, common areas, after-hours works, practical completion. Photos tagged **Before · site photo**.
- The line under the phone ends **not your actual programme**.
- No PO on the property → no "PO" anywhere on the phone.

## 4 · Demo painter (Settings → Website)

1. Settings → Website → under the painter cards, **Demo painter**. Pick a painter who has a photo; Save.
2. Re-open a customer link: the person card shows their name and photo; the first text says "**&lt;name&gt; and the team have arrived**"; the last text "**Your walkthrough with &lt;name&gt;**".
3. Set it back to **None**: the card reads **Your lead painter** with a plain avatar; texts say "The team have arrived".
4. A painter without a photo cannot be chosen (greyed out).

## 5 · Edge cases worth a look

- Reduced motion (macOS: System Settings → Accessibility → Display → Reduce motion): the card does not pulse; pressed, the phone shows everything at once with the finished text, nothing moves, Play again is disabled, label and line still show.
- A 360 px wide phone: no sideways scrolling; the phone sits inside the screen.
- An estimate with no photos: the phone plays, text only.
- A wizard-built estimate with a presentation: no card, no phone.
- A presentation with no capability panel (video or reviews only): the card sits in a small panel of its own after the blocks.

## 5b · Ask a question → the chat pops up (Tom, 20 Sep)

1. On the customer link, press **Ask a question** in the hero. The chat opens as a box in the bottom-right corner over the page (above the sticky total bar), headed **Chat with us**, with a × to close. Nothing scrolls.
2. Type a message, **Send message**: it appears as your bubble; staff see it on the estimate's thread (portal Messages tab / CRM) exactly as before.
3. Close it. **Message us** / **Open chat** in the **Ready when you are** panel opens the same box with the same thread. So does opening the link with `#chat` on the end (the "reply here" link in texts and emails).
4. The old **Ask a question** form with **Send question** is gone.
5. In the builder's ESTIMATE tab, **Ask a question** opens the box too, reading "Preview: your customer asks their questions here…", and Send is disabled.
6. (20 Sep, later) The bar at the bottom has **💬 Chat with us** next to **Accept estimate**; it opens the same box. On a 390-px phone both buttons and the total fit on one row.
7. Send a message on a Sunday (or after 4:30pm): an amber note appears under your bubble — *Thanks — we've received your message. Our office hours are Monday to Friday, 8:30am to 4:30pm; we'll get back to you as soon as we're open.* In hours: no note.
8. Staff side: the chat dock (bottom-left, any staff page) pops open with **Estimate chat · Waiting** for that customer; open it, reply — the reply shows on the customer's box and they get the reply text + email. Settings → Staff logins → tick **Customer chat message** for yourself first, then send another customer message: you get the *Chat from … — …* email/text with the message and a link to the estimate. Untick everyone: the office address gets the email instead.
9. With the reply domain configured: reply to that alert email from your staff address — your reply text appears on the customer's chat as a staff reply within a minute.

## 5c · Staff chat dock: always in the corner (Tom, 20 Sep)

Signed in as staff with NO customer chat open, visit Estimates, CRM, Invoicing, Projects and a builder: the **💬 Live chat** pill sits bottom-left on every one. Minimise and switch pages: still there. When a customer chats, it reads "1 chat" / "1 waiting" and pops open as before.

## 6 · What lands on the CRM record

After watching, the customer's record timeline shows **Watched the live-updates example on the estimate** — "Started playing", "Watched it through", "Pressed Play again", "Tapped See how you'll follow the job" (now: pressed the card). Started/completed/tapped once per page load; Play again every time.
