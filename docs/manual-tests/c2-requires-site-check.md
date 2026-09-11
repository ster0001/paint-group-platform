# Manual test — C2, `requires_site_check` decided once (11 Sep 2026)

No migration. There IS a data correction for existing proving rows — see the PR body.

## The regression audit 9.1 describes

1. As a customer, build an **interior** job in the wizard. On the condition screen, **add one photo**.
2. Finish to the reveal.
   - There is **no accept-online button**. The job says a person will confirm it.
3. Open the same estimate's **scope page**. Still no accept button — it must agree with step 2.
   Before C2 these two disagreed: the submit route said the customer could accept, the scope page
   said they could not, because the route passed "is this an exterior job?" where the ladder
   expected "does this need a person?".
4. In the database, the estimate's `requires_site_check` is `true` **and** the proving snapshot's
   `walkthroughRequired` is `true`. Before C2 the column said true and the snapshot said false.

## The other direction — make sure nothing got stricter by accident

5. Build a plain **interior** job with **no** condition photos, under the cap, fully confirmed.
   The accept-online path is still there. C2 must not have turned every job into a visit.
6. Build a plain single-storey **exterior** job. It still needs a person — that has always been
   true (an estimator signs every exterior job off) and is unchanged.

## What to watch on the proving dashboard

Rows submitted from C2 onward carry a `requiresSiteCheck` key in their snapshot. A row without
that key came from the affected window and its `walkthroughRequired` is only as good as the
correction SQL you run. The median-correction metric is unaffected either way — it compares
prices, and the prices were never wrong.
