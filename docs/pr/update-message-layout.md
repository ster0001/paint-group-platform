# fix(updates): the customer update in short sections, not one long sentence

Tom, 21 Oct 2026 — "the messages still aren't clearer". The proposal from 14 Oct, now built.

**Before**

> Hi Melissa — today we completed the front of the house: Walls — weatherboard and render, Windows × 3 and Entry door, and we have prepped the left-hand side (Walls — weatherboard) and will be back on that tomorrow. Photos attached (6).

**After**

```
Hi Melissa,

Here is today's progress (Friday 21 August):

Finished today
• Front of the house: walls (weatherboard and render), 3 windows and entry door

Prepped and ready for paint
• Left-hand side: walls (weatherboard) — we will be back on these tomorrow

6 new photos are on your job page.

Any questions, just reply to this message.
The Paint Group team
```

- Painter tick labels become customer words (`plainSurface`: *Windows × 3* → *3 windows*).
- A section the day did not earn is left out.
- Email prints it as written (already `pre-line`). The **text message** gets a one-line form: greeting + the bullets, no sign-off, 240 chars, then the job-page link (`smsSummary`, replaces the 180-char cut).
- Line breaks render on the Updates card, the job page's latest-update box and the customer portal timeline. The edit box is taller.
- No migration.

**Assumptions (change any and I will adjust):** "Hi" not "Hello"; sign-off is *The Paint Group team* (not the painter's name); the address stays in the email heading only.

**Checks:** typecheck (after `next typegen`), lint, 616 unit tests in `lib/workorder` + `lib/portal`; e2e `wo-updates.spec.ts` — see the run noted in the PR thread. Help: `docs/help/work-orders/pc.md` step 12.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
