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

## 1 · The customer's estimate — the warranty is an ATTACHMENT

1. Open any **sent** estimate as the customer would: `/e/<token>`.
2. Scroll to **Why Melburnians choose us**. There is now a fourth card — **2-year ·
   workmanship warranty on every job** — after public liability (and after the SWMS card
   when that job has one), with **⤓ Warranty terms (PDF)**.
3. The quote itself should say nothing more about the warranty: no clauses, no section of
   terms in the middle of the document. That is the point of this change.
4. Press **⤓ Warranty terms (PDF)**. It opens the warranty as its own document in a new tab:
   the heading, which estimate it is attached to, the promise, the exclusions and nine
   clauses. Check:
   - **1 · Who gives this warranty** names the company, the ABN and the address.
     ⚑ If the ABN or address is missing, fill in **Settings → Invoicing entity** — a
     warranty against defects has to name the warrantor.
   - **8 · Transfer to a new owner** reads *"personal to the customer named on the estimate
     and does not transfer"*. It must NOT say "being finalised".
   - Nowhere says DRAFT or AWAITING LEGAL REVIEW.
5. Press **Download as PDF** on the attachment. It should print as a clean white document —
   no buttons, no dark background, clauses not split across pages.
6. **← Back to your estimate** returns you to the quote.
7. Change one character of the token in the URL: `/e/<wrong-token>/warranty` must be a
   **404**, never someone else's warranty and never an error page with detail on it.
8. On a phone, the trust cards should sit 2 × 2 with the warranty card bottom-left.

## 2 · The printed quote

9. From the estimate press **Download PDF** (or Cmd-P → Save as PDF).
10. Above the paint list there is a **TWO-YEAR WORKMANSHIP WARRANTY** block — one paragraph:
    the cover, that it does not transfer, the Australian Consumer Law line, and that the full
    terms are attached to the online estimate. The clauses themselves are NOT on the quote.

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

- `e2e/estimate-warranty.spec.ts` — 6 specs, anonymous customer: the card's place in the
  trust row and that it points at the attachment, the terms NOT being on the quote, the
  attachment's clauses and warrantor details, an unknown token 404ing, the no-transfer
  clause, and the printed pointer. **Green on the test project 19 Sep.**
- `lib/warranty/terms.contract.test.ts` — 9 tests: two years everywhere, the nine clauses,
  clause 8 cannot say "transfers", the quote's line may not grow into the terms, and no
  component may keep its own copy of the words.
- `e2e/portal-aftercare.spec.ts` — the portal warranty card and the watermark flag. Green.
  (One unrelated test in that file is red on main: the colours page says "Colours to be
  confirmed" and the spec expects the singular. Not this work.)
