# Eyeball script — addendum A1: drawn variation signatures (5 minutes)

Run after migration `20261116_variation_signature_working_scope.sql` is live.
Everything uses an in-progress test job that has a priced variation (or raise
and price one on the PC job page).

1. **Open the variation link** (`/v/<token>` — copy it from the PC variation
   card). You should see: the quoted comment, the engine's line detail, the
   price, and **Job total $X → $Y incl. GST** under it.

2. **Tap Approve.** No instant approval any more — a *Full name* box and a
   white **signature pad** open, with the approval wording underneath.
   - Draw a squiggle but leave the name empty → "Please enter your full name."
   - Fill the name, tap **Sign and approve** → "Approved — thank you." with
     *Signed by \<name\> on \<date\>* underneath.

3. **PC job page** (`/pc/wo/<id>`): the variation card now shows
   *✓ Signed by \<name\> on \<date\>*.

4. **Invoice document**: after a final invoice re-drafts, the variation line's
   detail reads *Signed by \<name\> · \<date\>* instead of the plain
   "Approved by customer".

5. **Decline still one tap**: on a second priced variation, *No thanks* →
   *Confirm* works with no signature, and the job is untouched.

6. **The estimate is really frozen**: open an ACCEPTED estimate in the builder
   and try to save a change — the save is refused (client already blocked it;
   the database now does too, so nothing can slip around it).

What can go wrong and what it means:
- "We couldn't record that just now" on signing → check the RPC exists
  (`wo_customer_sign_variation`) — the migration's read-back lists it.
- A variation approved before this migration shows no *Signed by* line —
  correct: only post-A1 approvals carry signatures.
