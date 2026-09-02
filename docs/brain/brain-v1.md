# Paint Group Brain — v1 seed

**Status:** SEED, 1 Sep 2026. The Brain has only ever lived in chat; this file is the structured starting point that assistant session S6 imports into `brain_entries` as **drafts**. Nothing here goes customer-facing until Tom approves it in the platform (D14 ruling: `brain_entries` is the destination, Tom is the approver).
**Commit to:** `docs/brain/brain-v1.md`

**Entry format** (matches the `brain_entries` table): topic · question · answer · audience (customer / staff / both) · status. Everything below imports as `status: draft`.

**Honesty note:** entries marked **[PLATFORM]** are drafted from rulings already made in the platform build (deposit timing, ranges, warranty length, etc.) — factually grounded but wording unapproved. Entries marked **[TOM TO WRITE]** are known-needed topics where the actual Paint Group method lives in Tom's head or in past chats I don't hold verbatim — **including the caulking rule, which is recorded as existing but whose content must come from Tom, not be invented here.**

---

## Workmanship & method

### caulking-gaps · "How do you handle gaps and caulking?" · audience: both
**[TOM TO WRITE]** — the standing "caulking rule" exists; paste the real rule here. Placeholder answer must NOT ship.

### prep-standard · "How much preparation is included?" · both
**[TOM TO WRITE]** — what's absorbed into the paint pass vs itemised prep lines (the 1.25 first-time-right boundary from the allowances spec is the staff-side anchor).

### coats-standard · "How many coats do you apply?" · both
**[PLATFORM]** Two coats is our standard. A single coat is only offered as a refresh in the same colour — one coat over a colour change will not cover properly, so we don't do it. ⚑ pending Tom's confirmation of the single-coat gating ruling.

### finish-levels · "What does a level [x] finish mean?" · both
**[TOM TO WRITE]**

### paint-brands · "What paint do you use?" · customer
**[TOM TO WRITE]** — brands stocked (Haymes/Dulux trade accounts exist), when each is chosen, customer-supplied paint policy.

### colour-match · "Can you match my existing colours?" · customer
**[TOM TO WRITE]** — method (scan/chip), accuracy expectations, when colour consult applies. Note for staff entry: colour coordination is an allowance, colours TBC is a state never a row.

### lead-paint · "My house is older — is the paint dangerous?" · customer
**[PLATFORM — legal-adjacent, wording needs review]** Homes painted before the 1970s may have lead-based paint. If your paint is peeling or flaking and the home is from that era, we don't price this online — we inspect first and follow safe-work practice. Scripted hard-stop wording lives in agent_settings; this entry links to it.

## Money & process

### deposit · "When do I pay, and how much?" · customer
**[PLATFORM]** A deposit is payable when you accept your estimate, and the balance at sign-off, once you've approved the finished work area by area. Card or bank transfer; receipt issued instantly. (Deposit % is a Settings value — the entry must render the live value, never a hard-coded number.)

### price-range · "Why is my price a range and not a fixed number?" · customer
**[PLATFORM]** Your range reflects what we haven't yet seen or confirmed — it narrows as you confirm details, and becomes a fixed price after review or a short site visit. We'd rather be honest about uncertainty than precise and wrong.

### price-validity · "How long does my estimate last?" · customer
**[PLATFORM]** Held for 60 days from the date it's issued. ⚑ confirm 60 is the ruled validity figure; render from Settings.

### variations · "What if something extra comes up during the job?" · customer
**[PLATFORM]** Nothing extra is ever done or charged without a priced variation you approve in writing first, with photos of why it's needed.

### trade-terms · "Do trade clients get account terms?" · customer
**[PLATFORM — BLOCKER]** Display-only "14-day terms" exists as a default but the real trade payment behaviour is an unruled BLOCKER (portal ⚑5). This entry must answer "we'll confirm terms when your trade account is set up" until ruled.

## Warranty & after

### warranty · "What warranty do you provide?" · customer
**[PLATFORM]** A 2-year workmanship warranty, provided as a warranty card in your account at completion, alongside your colour register — every brand, colour code and sheen on every surface, kept permanently. ⚑ warranty terms text itself is under legal review (DRAFT watermark rule stands); this entry links to the document rather than restating terms.

### colour-register · "Will I know what colours were used later?" · customer
**[PLATFORM]** Yes — your colour register records brand, code and sheen per surface, downloadable any time from your account.

## Practicalities

### occupied · "Can you paint while we're living in the house?" · customer — **[TOM TO WRITE]** (occupied allowance exists staff-side; the customer-facing method statement is Tom's)
### timing-duration · "How long will my job take?" · customer — **[TOM TO WRITE]**
### service-area · "Where do you work?" · customer — **[PLATFORM]** Within ~50 km of Melbourne. (Sydney entry added when that launches; render from Settings.)
### insurance · "Are you insured?" · customer — **[PLATFORM]** Public liability certificate is attached to every estimate and available in your account. ⚑ other certs per portal D13.
### who-comes · "Who will be in my home?" · customer — **[TOM TO WRITE]** (named PC/crew model exists; the reassurance copy is Tom's)

## Staff-only

### charge-out-vs-rev · "What do the two $/hr figures mean?" · staff
**[PLATFORM]** Charge-out is the customer-facing rate on the line; revenue-per-hour is what the job actually yields after allowances and pass-throughs. Both are engine outputs — never recompute by hand, and never quote either to a customer or contractor.

### assumed-provenance · "When can I mark something human_confirmed?" · staff
**[PLATFORM]** Only when a person actually said or verified it. The assistant and reader can never upgrade provenance; you can.

---

## Import instructions (assistant S6)

1. Parse each `###` entry → one `brain_entries` row, `status: draft`, audience as tagged.
2. **[TOM TO WRITE]** entries import with `answer_md` = the placeholder text and a `needs_content` flag — the retrieval layer must treat them as absent (answer honestly "no entry yet, want a person?"), never serve placeholder text.
3. **[PLATFORM]** entries that reference Settings values must render the live value at answer time.
4. Approval UI: Tom approves per entry; only `approved` entries are retrievable customer-side.
