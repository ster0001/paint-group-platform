# Manual test — C3, draft versioning and one server truth (11 Sep 2026)

**Migration `20270136000000_wizard_drafts_version.sql` must be live first**, on production
AND on the C1 test project. Without the `version` column every write takes the old path and
nothing below is testable.

## The two-tab loss

1. Open `/estimate` as a customer (a private window — anonymous). Answer the address screen.
2. Open a **second tab** on `/estimate`. It picks up the same draft.
3. In tab B, answer the next screen. Wait five seconds (the autosave debounce is 2.5s).
4. In tab A, answer a different screen. Wait five seconds.
5. **Neither answer is lost.** Reload either tab: both answers are there.

Before C3, step 4 erased step 3 and nothing said so.

## What the customer must never see

6. Through all of that, no error appears in tab A. A conflict is not the customer's problem —
   they are mid-sentence. The merge happens underneath them.

## Refresh mid-walk

7. Part-way through, hard-refresh. You land on the screen you were on, with your answers.

## The confirmation rule

8. In tab A confirm a room ("Looks right"). In tab B, without reloading, confirm a different
   room. Reload both. **Both confirmations survive.** A confirmation is someone positively
   saying "yes, that's right" — a merge may never withdraw one.

## Where they were

9. As staff, open the CRM record for that session. `last_screen` reads a word, not a number —
   `quick:condition`, `page:rooms` — so you can see where they actually are.
