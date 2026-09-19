# Manual test — the warranty: approved, non-transferable, and on the estimate

Branch `feat/warranty-approved-on-estimate`. One migration:
`20270174000000_warranty_terms_approved.sql` (paste on TEST first, then PRODUCTION).

The migration ends with a `select` — read it. It must come back:

```
key             | approved | approved_at          | terms_version | transferable
warranty_terms  | t        | 2026-09-…            | 2026-09-19    | f
```

`approved = t` is the thing that takes the DRAFT watermark off. If there is no row, or
`approved` is `f`, the portal is still watermarking the certificate and the terms.

(The same switch is on **Settings → Documents** — the warranty terms approval tick. The
migration just does it on both projects in one paste, and records who and when.)

---

## 1 · The customer's estimate — the new part

1. Open any **sent** estimate as the customer would: `/e/<token>`.
2. Scroll to **Why Melburnians choose us**. There is now a fourth card — **2-year ·
   workmanship warranty on every job** — after public liability (and after the SWMS card
   when that job has one), with a **↓ Read the warranty** link.
3. Press the link. It jumps to **Your two-year workmanship warranty**: the promise, what it
   does not cover, and **THE WARRANTY IN FULL**.
4. Open **THE WARRANTY IN FULL**. Nine clauses. Check:
   - **1 · Who gives this warranty** names the company, the ABN and the address.
     ⚑ If the ABN or address is missing, fill in **Settings → Invoicing entity** — a
     warranty against defects has to name the warrantor.
   - **8 · Transfer to a new owner** reads *"personal to the customer named on the estimate
     and does not transfer"*. It must NOT say "being finalised".
   - Nowhere on the page says DRAFT or AWAITING LEGAL REVIEW.
5. On a phone, the trust cards should sit 2 × 2 with the warranty card bottom-left.

## 2 · The printed quote

6. From the same estimate press **Download PDF** (or Cmd-P → Save as PDF).
7. Above the paint list there is a **TWO-YEAR WORKMANSHIP WARRANTY** block: the promise,
   "does not transfer", and the Australian Consumer Law line.

## 3 · The customer's account — the watermark is gone

8. Sign in as a customer with a **signed-off** job and open **Home → Your documents**.
9. The **Two-year workmanship warranty** card shows with its countdown chip. Below,
   **The warranty in full** — the same nine clauses, with no diagonal DRAFT watermark
   across them.
10. Press **Warranty certificate (PDF)**. The certificate opens with no watermark either.
    **Download as PDF** prints it clean.
11. Clause 8 on this page says the same thing as the estimate — they render from the same
    module now, so they cannot drift apart.

## 4 · What has NOT changed (and why)

- There is **no** per-estimate switch to remove the warranty, and no per-job term. Two
  years, everybody, by your ruling on 19 Sep. If that ever needs to change it is a schema
  change, not a setting.
- Sign-off still writes the `warranties` row with `years = 2`. Nothing about existing jobs,
  certificates or countdowns moves.

## Automated cover

- `e2e/estimate-warranty.spec.ts` — 4 specs, anonymous customer: the card's place in the
  trust row, the terms opening, the warrantor's details rendering, no watermark, the
  no-transfer clause, and the printed block. **Green on the test project 19 Sep.**
- `lib/warranty/terms.contract.test.ts` — 7 tests: two years everywhere, the nine clauses,
  clause 8 cannot say "transfers", and neither component may keep its own copy of the words.
- `e2e/portal-aftercare.spec.ts` — the portal warranty card and the watermark flag. Green.
  (One unrelated test in that file is red on main: the colours page says "Colours to be
  confirmed" and the spec expects the singular. Not this work.)
