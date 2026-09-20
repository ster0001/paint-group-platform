# Manual test — the live-progress phone on the customer estimate

Branch `feat/estimate-live-progress`. **No migration.** Brief: `docs/briefs/claude-code-brief-estimate-live-progress-v4.md`. Mockup: `design/reference/estimate-live-progress-mockup-v4.html`.

A test-stack walk can be seeded with `node scripts/c1/seed-live-progress.mjs` (prints two `/e/` links; `--remove` cleans up).

---

## 1 · With a presentation: the phone

1. Open a **sent** estimate that has a presentation ticked, as the customer: `/e/<token>`.
2. Below **Scope of works, item by item** and above **The paint we're supplying** there is a section with only: the label **Example of your live updates**, a phone, **↻ Play again**, and a line starting **For illustration only**. No headline, no paragraph, no bullets.
3. Scroll it into view. Within a second a text slides onto the lock screen: **Good morning &lt;first name&gt;. The team have arrived at &lt;street&gt;.** (With a Demo painter set: **Good morning Ben. Jacob and the team have arrived…**)
4. The text is tapped, the job opens: the street in the header, the suburb and "for &lt;full name&gt;" under it, **In progress**, Day 1, a lead-painter card.
5. Five updates rise one by one, roughly every 3 seconds. Day 1 names the first rooms on the estimate; Day 3 names the ceiling product; Day 5 the wall product. Photos are the estimate's own "as we saw it" photos, tagged **Before · your photo**, at most two per update, none repeated.
6. After the last update the pill turns **Ready for walkthrough** and the finished text appears: **&lt;first name&gt;, &lt;street&gt; is finished. Your walkthrough is at 2pm today.**
7. It holds about 6 seconds, then loops. Scroll it off screen, scroll back: it starts from the lock screen. Switch tabs and back: same.
8. **↻ Play again** restarts from the lock screen.
9. The hero has a third button, **See how you'll follow the job**, and step 4 of **What happens when you accept** has **See it for your address ↑**. Both jump to the phone.
10. **Download estimate (PDF)** / print preview: the section is absent.
11. Accept the estimate exactly as before. It accepts.

## 2 · Without a presentation

Open a sent estimate with no presentation. No section, no hero button, no step-4 link. Scope of works runs straight into The paint we're supplying.

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

- Reduced motion (macOS: System Settings → Accessibility → Display → Reduce motion): the phone shows everything at once with the finished text, nothing moves, Play again is disabled, label and line still show.
- A 360 px wide phone: no sideways scrolling; the phone sits inside the screen.
- An estimate with no photos: the phone plays, text only.
- A wizard-built estimate with a presentation: no phone.

## 6 · What lands on the CRM record

After watching, the customer's record timeline shows **Watched the live-updates example on the estimate** — "Started playing", "Watched it through", "Pressed Play again", "Tapped See how you'll follow the job". Started/completed/tapped once per page load; Play again every time.
