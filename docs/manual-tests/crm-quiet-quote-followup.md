# Manual test — CRM Today: a sent quote gone quiet is a Follow-up (15 Sep 2026)

Migration to paste first (test AND prod): `supabase/migrations/20270148000000_estimates_sent_idx.sql` (an index only).

1. Settings → CRM: note "Chase an unopened estimate after" (default 3 days) and "Chase an opened, silent estimate after" (default 5).
2. Find a customer with a quote sent more than 3 days ago that nobody has opened and nobody has called or messaged since.
3. CRM → Today (Everyone, or Mine if you own them) → the **Follow-ups** chip. There is a card "<name> — quote sent, no reply" with the value, "sent Nd ago", "never opened" and one button, **Follow up →**, which opens the customer record.
4. Log a call on that record. Back on Today the card is gone. It returns after the threshold days if nothing else is logged, under a new key, so a Dismiss of the first round does not hide the second.
5. A quote quiet for 14+ days (the "going cold" setting) reads "<name>'s quote is going cold".
6. A customer with three sent quotes shows one card, for the newest.
7. The Estimates page's Waiting on you tab does NOT show these cards: it is the estimator's confirmation queue, and a chase is a CRM job.
