# Manual test — C4, Outside + Commercial and the exterior finish line (11 Sep 2026)

No migration.

## 9.3(b) — the promise counts the real screens

1. Open `/estimate`. With **Inside** picked, screen 1 says "Four quick screens".
2. Pick **Outside** — it says "Three".
3. Pick **Both** — it says "Five".

The dots under the header always matched; only the sentence lied.

## 9.3(a) — a business visitor sees the quick look

4. Open `/estimate?mode=business`. You land on screen 1, not on a hand-off.
5. Type an address, Continue → **screen 2**. Before C4 this first Continue exited the quick
   look entirely: promised four screens, given one, with no explanation.

## 9.3(c) — commercial outside never gets house questions

6. Screen 1 → **Outside**. Continue. Screen 2 → **Commercial**. Continue.
7. You get **"This one deserves a person"**, saying we price commercial work outside on site.
8. You do **not** get "What we're painting" with house / fence / deck / shed, and you are not
   silently returned to screen 1.
9. Repeat with **Both** — same hand-off.
10. Repeat with **Inside** + Commercial — that one still goes into the question pages, where
    the segment question and the gates live. That is deliberate and unchanged.

**Check the lead landed:** in the CRM, that session exists with the address, the job type and
commercial as the kind. The draft is flushed at the hand-off rather than waiting for the
autosave, so closing the tab on that screen does not lose them.

## 9.4 — an exterior job has a finish line

11. Walk an exterior job to the sides editor, then open its finish line
    (the estimate's own link, or `/estimate/finish?id=<id>`).
12. You see the range, what you told us (sides checked, storeys and cladding, doors and
    windows, the condition answers), and two doors: **Send for confirmation** and
    **Book a site visit instead**.
13. There is no "Fix my price online" — an estimator signs every exterior job off.
14. The wording says "checks your **sides**", not "your rooms".

Before C4 this screen said "Open your estimate to finish it off" — screen 10 dead-ended for
every exterior customer.
