# Manual test — photos the office attaches for the painter

The case this was built for: a job handed over from PaintScout, where the
estimate carries no photos and the job sheet's own photos froze at acceptance,
so there was nothing to show the painter at all.

Paste the migration first and **read the row it prints back**:

    supabase/migrations/20270190000000_wo_reference_photos.sql

Every value has an `_expect_` beside it. `anon_may_record` must be `false` and
`anon_may_read_by_token` must be `true` — anyone holding the job-sheet link can
SEE the photos, nobody anonymous can add one. The last statement writes the
`_prod_migrations` row; no row means the paste did not finish.

**If the first line errors** with "unsafe use of new value" or "cannot run
inside a transaction block", run this line on its own first, then the rest:

```sql
alter type public.wo_photo_kind add value if not exists 'reference';
```

## 1. Attach one

Open a PaintScout job: **Projects → the job → Photos for the painter** (just
above Level of finish). Pick an area or leave it on **Whole job**, type a
caption, choose a photo.

Expect: "Added — it's on the painter's job sheet.", and the photo appears in the
card with its area, caption and time.

## 2. The painter's own copy

Open the job-sheet link (`/w/<token>`) **in a private window** — no session,
exactly what they see.

Expect: a **From the office** section near the top, above Scope of works, with
your photo, its caption, and the area it belongs to. Tap it: full size.

Then check the portal copy: sign in as the contractor and open the job under
**Jobs**. Same section, same photo.

## 3. The painter's own photos stay theirs

On a job where the painter has already uploaded before/progress shots, check the
job sheet again.

Expect: their shots are under **Site photos**, further down — **not** under
From the office. The two sections never mix: one is what we told them, the other
is what they did.

Try removing one of theirs through our door:

```sql
-- pick any before/progress/qa/completion photo id
select public.wo_delete_reference_photo('<a painter photo id>');
```

Expect `error:not_a_reference_photo`. Their record is not ours to delete.

## 4. Only the office can attach one

```sql
-- as anon (the contractor's own key)
select public.wo_record_reference_photo('<work order id>', 'wo/x/y.png', '', '');
```

Expect: permission denied — `anon` has no execute on it. A signed-in contractor
gets `error:not_staff` from the guard itself, not merely a missing button.

## 5. A closed job is final

On a closed job the card is not rendered, and the RPC answers `error:closed`.

## 6. What it recorded

```sql
select type, meta, at from wo_events
 where work_order_id = '<work order id>'
   and type in ('reference_photo_added', 'reference_photo_removed')
 order by at desc limit 10;
```

Expect one row per photo added or removed, carrying the area and caption — so a
photo that appeared or vanished between the offer and the start can be explained.
