# Manual test — correcting the level of finish on a job that is already out

This is the 1 McNamara case: the job is being done to Level 2, the sheet the
painter holds says Level 3, and changing it in the revision builder never
reached them.

Paste the migration first, in the Supabase SQL editor, and **read the row it
prints back** before using the screen:

    supabase/migrations/20270189000000_wo_set_finish_level.sql

Every value in that row has an `_expect_` beside it. They must match — in
particular `anon_may_execute` must be `false`. The last statement writes the
`_prod_migrations` row; if that row is missing, the paste did not finish, whatever
the editor appeared to do.

## 1. The job page shows what the painter is actually held to

Open the job: **Projects → the job → Level of finish** (just above Materials).

Expect: "This job sheet holds the painter to **PG-3** · Premium — Full prep per
scope, uniform finish, crisp cut lines (priced as Level 3 — Good. Full prep,
filled, sanded, sealed, caulked)". If any area on the job carries a level of its
own, the card names those areas and says they will keep it.

Expect the dropdown to offer **Level 2 · PG-2 — Utility**, **Level 3 · PG-3 —
Premium** and **Level 4 · PG-4 — Showcase**, and **no Level 1**. Level 1 has no
contractor standard; offering it would hold a painter to more prep than the
customer paid for.

## 2. Correct it, and check the painter's own copy

Pick **Level 2 · PG-2 — Utility** and press **Save to the job sheet**.

Expect: "Saved — the painter's job sheet carries the new level." and the line
above now reads **PG-2 · Utility**.

Now open the painter's copy — **Painter's view**, or the `/w/<token>` link from
their offer, ideally in a private window so you are looking at it with no
session, exactly as they do.

Expect: **PG-2** at the top, the Utility prep list behind it, and no PG-3
anywhere. Any area you were told would keep its own level still shows that
level beside it.

## 3. The price did NOT move — and that is deliberate

```sql
select total_cents, accepted_total_cents, level_of_finish
  from estimates where id = '<the estimate id>';
```

Expect: unchanged, and `level_of_finish` still 3. The accepted estimate is the
signed record of what was priced, and it stays frozen.

The money for this change is the variation you draft in **Revise scope** — set
the level there, **Save & draft variations for signature**, and the customer
signs the credit. Level 2 is ×0.89 against Level 3's ×1.00, so on a job priced
at Level 3 it comes back as a credit of about 11% of the labour, and the
contractor's pay drops with it. **Both halves need doing**: this screen for what
the painter builds, the variation for what everyone is paid.

## 4. It is staff-only, and a closed job is final

```sql
-- as anon (the contractor's own key): must be refused outright
select public.wo_set_finish_level('<work order id>', 'FIN-2');
```

Expect: permission denied — `anon` has no execute on it.

On a **closed** job the card is not rendered at all, and the RPC answers
`error:closed` if called directly. A closed job's sheet is final.

```sql
select public.wo_set_finish_level('<work order id>', 'FIN-1');
```

Expect `error:bad_level` — refused, not silently promoted to PG-2.

## 5. What it recorded

```sql
select type, meta, at from wo_events
 where work_order_id = '<work order id>' and type = 'finish_level_edited'
 order by at desc limit 5;
```

Expect one row per correction, carrying `from_code`, `from_label`, `to_modifier`,
`to_code` and `to_label` — so a level that changed between the offer and the
start can always be explained to the painter.
