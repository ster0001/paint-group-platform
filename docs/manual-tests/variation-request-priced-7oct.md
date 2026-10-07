# Manual test — a painter's request priced in the working scope (7 Oct 2026)

Needs: migration `20270222000000_variation_request_priced_in_scope.sql` live (check `_prod_migrations`), a job under way with a contractor on it who has an email (and ideally a mobile) on file.

1. As the contractor, on the job's portal page: **Variations → + FOUND SOMETHING**, describe it ("Ivy walls beside the front door"), send.
2. As staff, open the job in PC Command. The variation card is at RAISED. Press **Price it in the builder — working scope**.
   - Expect: the builder opens in Revise scope with a blue line at the top of the changes panel: "Pricing <painter>'s request: 'Ivy walls…'".
3. Add the work to the scope (a new area or surface), then **Save & draft variations for signature**.
   - Expect: one offer row. Back on the job page, the SAME variation card is now at PRICED ("with the customer") — there is no second card. The painter's portal shows the chip **WITH THE CUSTOMER** on their own request.
4. (Optional) Take the change back out of the scope and draft again — the card returns to RAISED, not cancelled. Put it back and draft again.
5. Send the signing link; as the customer, sign on `/v/<token>`.
   - Expect: the card reads "Released — waiting on the contractor to accept" with a **Remind the painter** button. The contractor gets a text AND an email "A variation on PS-xxxx is waiting on you". If they have no mobile, the email alone. If they have neither, the Remind button answers "Nothing went out — No email or mobile on file."
6. As the contractor: the request shows **Variation approved by the client**, amount and hours, **Accept** / **Decline**. Accept.
   - Expect: ACCEPTED, pay line updated, the tick row for the work is on the list.
7. Press **Remind the painter** on a released variation at any time — it sends again and says what went out.

Cavell Court itself: paste `supabase/fixes/cavell-court-variation-to-painter.sql` (read-back: 53f5… customer_approved, released, not accepted; de5b… cancelled), then open PS-3156 and press **Remind the painter** — Qudrat is emailed.
