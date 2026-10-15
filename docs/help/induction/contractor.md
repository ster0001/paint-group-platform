---
feature: induction
role: contractor
title: Your induction — choose your language, read each module in it, tick it
summary: Pick the language you read best on the first screen of the induction (English, Dari, Farsi, Arabic, Spanish, Portuguese or Italian, as Paint Group switches them on). Everything you read and tick to confirm — the thirteen modules and the six finish standards sections — is then in that language; the app, the slides and the practice job stay in English. One tick per module, resumable; the last tick completes the induction and emails you a PDF of everything you ticked. Job offers start when the induction is complete, your facilitator has passed the practical check, and your public liability insurance is on file. Existing contractors do the shorter refresher with no practical check; a worker login does the worker version and can be put on a job once it is complete and checked.
sources: app/portal/induction/page.tsx, app/portal/induction/language/page.tsx, app/portal/induction/[module]/page.tsx, app/portal/induction/TickStep.tsx, app/portal/induction/actions.ts, app/portal/induction/LanguagePicker.tsx, app/join/[token]/JoinForm.tsx, lib/induction/read.ts, lib/induction/status.ts, lib/induction/notify.ts, lib/standards/localize.ts, supabase/migrations/20270267000000_induction_content.sql, supabase/migrations/20270270000000_induction_signoff.sql
---

## What this is for
On induction day you watch the slides, do each step in 12 Demo Street on your phone, then read a few lines and tick them. Those lines are the only part that is in your own language, so there is nothing to misunderstand. The finish standards you sign in Module 5 are in your language too.

## Before you start
- You have your login (the invite text or email). Workers get theirs from their contractor.
- Nothing else. Your language can be chosen before the first module and changed later.

## Steps
1. **Choose your language.** The invite link asks first. Later, Home shows **Choose your language** until you have; tap it and pick one. Only languages Paint Group has switched on are offered. English is always there.
2. **Open the induction.** From Home tap **Induction** (or Help → **Induction**). The list shows the thirteen modules with the time each takes, titled in your language.
3. **Read a module and tick it.** Tap one. The **Read and confirm** lines are in your language. Under them, **On your phone** lists the steps of that module in 12 Demo Street, ticked live as you do them. At the bottom, tap the tick line, then **Next module**. The tick is saved at once, so you can stop and come back; the list shows **Ticked** and **Next**.
4. **Module 5 is the finish standards.** Its six lines link to the six standards sections; open each one and tick it there. The sections read in your language. The module shows as ticked when all six are in.
5. **The last tick** shows **Induction complete** with the date and version. A PDF of every line you ticked, in your language, is saved under your documents and emailed to you.
6. **The practical check.** Before you leave, your facilitator watches you do five things in the practice job without help (accept a job, add a before photo, move a surface to prepped, raise a variation, submit an invoice) and records pass or not yet on their screen. Not yet means you repeat that module and try again the same day.
7. **Job offers start when** the induction is complete, the practical check is passed, and your public liability insurance is on file. Home and the completion screen say which of those is still to come.
8. **Existing contractors** do the shorter **refresher**: What is changing, then Modules 3, 7, 8, 9 and 6, plus the six standards sections. No practical check. The office invites you; you have the same grace period as the standards to tick it before job offers pause.
9. **Workers** do the worker version on their own login (ten modules). Once it is complete and the three-task check is passed, your contractor can put you on a job.
10. **Change your language** any time: Induction → **Change language**, or Profile → **Your language** → **Change language**. The record keeps the language you confirmed in.

## What the colours and labels mean
- **Choose your language** (amber card on Home) — not chosen yet; everything reads in English until you choose.
- **Reading in …** — your current language, shown on the induction and your profile.
- **N lines shown in English until the … wording is ready** (amber) — a line has no translation yet; the English stands in so nothing is blank.
- **chosen** beside a language on the picker — the one you have now.
- **N of M** (amber chip on Home) — modules ticked so far; **Complete** (cyan) — every module ticked; green once the practical check is passed too.
- **Ticked / Next** on the module list — done, and the one to do now.
- **What changed** (amber box on a module) — the wording of that module changed in a material way; read it and tick it again. Your other ticks stand.
- **Practical check with your facilitator** on the completion screen — the five (or three) tasks still to be watched.

## If something goes wrong
- **My language is not in the list** — Paint Group has not switched it on yet. Pick another for now and change later; ask the office when yours will be ready.
- **A word is wrong in my language** — tell the office which module and line. The wording is tested by Paint Group's team and corrected from what painters report.
- **Everything is still in English after I chose** — reload the page, or choose again from your profile. If it stays English, ring the office.
- **I ticked everything but get no job offers** — the practical check is not recorded yet, or your insurance is not verified. The completion screen says which. Ask your facilitator or the office.
- **The module list is shorter than thirteen** — you are on the refresher (existing contractors) or the worker version. That is correct.
- **A worker cannot be shared onto a job** — their worker induction and check are not complete. Their own Home shows where they are.

## Related
- [Finish standards — contractor](../standards/contractor.md)
- [Worker logins — contractor](../worker-logins/contractor.md)
- [Demo property — contractor](../demo-property/contractor.md)
