# Manual test — Home dashboard v2 · session 0a (capture: estimates + presentations)

Run migration `20270175000000_dashboard_capture_estimates.sql` first and read the
select at its end: expect `new_columns_expect_5 = 5`, `new_triggers_expect_4 = 4`,
`send_requires_lead_source = true`, `staff_may_write_lead_source = true`,
`staff_may_write_sender_expect_false = false`, `presentations_without_label_expect_0 = 0`.
The count columns tell you what the backfill found.

1. **Settings → Presentations.** Every presentation's row now reads "category <label>".
   Edit one: a **Category label** field sits under the name. Type "Interior repaint", click
   away — the list shows it. Clear it, click away — it reads the presentation's name again.
2. **Builder, new estimate.** Under Job settings, above Presentation, **Lead source** reads
   "— required —". Choose a level of finish, press **Send**: the red message says
   "Pick where this lead came from (Lead source, under Job) before sending." and no dialog opens.
3. Pick **Referral**, save, Send. The estimate sends as before.
4. **Estimates list → that customer's record** (CRM): the account now carries lead source
   Referral and, if a presentation was ticked, that presentation's category label.
5. Build a second estimate for the same customer with a different presentation and a
   different lead source; send it. The account keeps Referral and the first category.
6. **Customer view.** Open the sent link in a private window, press **Download estimate (PDF)**.
   Back in the builder's Activity tab an entry "downloaded" appears (the print dialog opens as before).
7. **Online estimate.** Start a wizard estimate from a Google ad link (`?gclid=x`) or any UTM
   link, give an email, finish. In the builder the Lead source is already filled (Paid Google for
   the gclid case); it can be changed before sending.
8. Duplicate an estimate from the list: the copy carries the original's lead source.
