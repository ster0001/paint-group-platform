# Trade portal v2 — Tom's walkthrough (Session 7)

**Date:** 31 Aug 2026 · **Branch:** `feat/trade-portal-v2` · **Mockup:** `design/reference/trade-portal-v2-mockup.html`
Walk the mockup and the build side by side on your phone; return a numbered defect list. Nothing is "workable" until that list is fixed.

## Getting it on your phone

```bash
cd /Users/tomroman/Documents/paint-group-platform && node scripts/portal/seed-trade-demo.mjs && ./scripts/c1/serve.sh
```

The seed is idempotent (re-run it any time to reset the walk states); `serve.sh` prints the phone URL — `http://<your-mac's-IP>:3101/account/login` on your wifi. Everything runs on the **test** project.

## Logins (all password `painttest123`)

| Login | Persona | What to look at |
|---|---|---|
| `pg.demo.agency@example.com` | Harbourside Property Management (real estate, 12 properties) | The main walk below |
| `pg.demo.facilities@example.com` | Bayside Aged Care — Facilities (6 sites) | Site / PO reference labels |
| `pg.demo.insurer@example.com` | Southern Cross Claims (9 claims) | Claim / Assessor labels, send-to-assessor |
| `pg.demo.finance@example.com` | Finance seat on Harbourside | Money and nothing else |
| `pg.demo.volume@example.com` | 40-property org | Scroll + search feel at volume |

## The walk (mockup screen order)

**1 · Portfolio** (mockup screen 1 ↔ `/account` as the agency)
1. Header: org name, today's date, "N jobs on site this week".
2. Four pulse tiles — tap each; the property list filters; tap again to clear.
3. Needs you: estimate awaiting approval (14 Beaumont St) with one primary action.
4. Property cards top to bottom: Awaiting you · On site day X of Y (Unit 7/22 Ormond Rd, progress 11/24) · Ready to sign off (3 Tennyson St) · Invoice overdue (9 Mitford St) · No active work (28 Broadway, "colour card on file") — each with its swatch strip and reference line.
5. Search "Nguyen" (a reference value), then a job number, then clear.
6. The two 10-second questions, timed: *what colour is the hallway at Unit 7/22 Ormond Rd* (search → card → Colours) and *is Ormond Rd finishing on its expected day* (the card chip + Progress tab). e2e answers both in ~3 s.

**2 · Property** (mockup screen 2 ↔ tap Unit 7/22 Ormond Rd)
7. Header: address + reference chips (Owner · Elwood Holdings, Your ref · EH-0448).
8. Progress: six-stage rail, start/expected finish, surfaces done, "Open full timeline", job history.
9. Colours: cards per record — swatch + code, area, status chips, Hallway = Natural White; Previous section dimmed; **Download colour card (PDF)** (check the where-to-buy line once you've set it in Settings → Trade accounts) and Request a touch-up.
10. Money: this-job total, paid so far, the property's invoices.
11. Documents: per-property, then About Paint Group (your $20M cert et al.).

**3 · Timeline** (mockup screen 3 ↔ Progress → "Open full timeline")
12. Same feed as residential — day groups, photos, PC-approved updates — plus "Colours confirmed & paint ordered" and "Painter confirmed" events where the data exists.

**4 · Approve** (mockup screen 4 ↔ Needs you → "Review estimate" at 14 Beaumont St)
13. References + total + terms line; colours block ("repeat the colour card on file"); **Approve on behalf of the owner** · Send to the owner to approve · Ask a question. Don't tap Approve if you want to keep the walk state — re-run the seed after.
14. Switch personas: facilities shows "Approve with PO number" + the PO field; insurer shows "Approve against the claim" / "Send to the assessor".

**5 · Money** (mockup screen 5 ↔ Money tab)
15. Outstanding / overdue tiles; receivables grouped by property, references on every line; Statement (PDF); Export CSV.

**6 · Team** (mockup screen 6 ↔ Team tab as the agency)
16. People with role, scope, approval limit; per-person Updates routing; invite form; the digest explainer.
17. Log in as `pg.demo.finance@` — lands on Money, one tab, property pages bounce.

## Org framing is editable, not hardcoded (your session-7 note)

Real estate / facilities / insurance are **examples**. Per account, Settings → Trade accounts → "Approvals & terms" edits the org kind (`real_estate · facilities · insurance · builder · body_corporate · other`) — it drives copy defaults and reference-label suggestions only, never permissions. Reference labels themselves are free-form per property (any label prints anywhere references print), and kinds outside the three examples get generic approval copy ("Approve this estimate" / "Send to a colleague to approve"). A genuinely new business framing costs one enum value + one label-defaults line.

## Honest gaps vs the brief's §7 table

| Item | State |
|---|---|
| Sessions 0–6 acceptance rows | All green (diagnostics, RLS 6/6, write path, screens, timeline reuse, approvals 5/5, money/team/digest 4/4, personas 6/6; 40-property render 606 ms) |
| References on **invoices & variations** documents | NOT yet — estimate document + completion report done; the invoice/variation renderers need their own pass |
| `po_required_to_invoice` enforcement | Stored per account; the final-invoice-issue gate belongs to invoicing, not yet wired |
| Colour records for **variations-added scope** | Write path covers the estimate tree; scope added mid-job via variations isn't grouped into colour records yet |
| "Trade account" tag in the portal header | ⚑13 pending — customer-facing naming ruling ("Your Paint Group workspace"?) will rename it |
| ⚑12 org kinds at launch / ⚑14 timeline sharing | Pending your rulings — nothing built for ⚑14 |
| Digest cron in prod | You: schedule `GET /api/cron/trade-digest` (header `x-cron-secret`) hourly or 17:00 Melbourne |
| Old 3a-7 Properties tab | Still present alongside the new portfolio (additive build); retire after your walk if the portfolio covers it |

**Definition of done:** you walk it, return the defect list, we fix, then the module is workable.
