-- =============================================================================
-- A job with no paint products was permanently stuck at pre-start
--
-- wo_colours_confirmed() answered FALSE when the work-order document listed no
-- materials, so "colour schedule finalised" could never become true and the job
-- could never start. Blocking for ever is worse than the thing the check exists
-- to prevent: there are no colours to confirm, so the step is vacuously done.
--
-- A MISSING document still answers false — that is genuinely "we cannot tell",
-- and a work order without one has not been issued, so it should not be at
-- pre-start in the first place.
-- =============================================================================

create or replace function public.wo_colours_confirmed(p_work_order_id uuid)
returns boolean language sql stable set search_path = public as $$
  select case
    when w.wo_snapshot is null then false          -- cannot tell
    else not exists (                              -- no materials => nothing to confirm
      select 1
        from jsonb_array_elements(coalesce(w.wo_snapshot->'materials', '[]'::jsonb)) m
       where coalesce(w.colours -> (m->>'product') ->> 'status', 'tbc') <> 'confirmed'
    )
  end
  from public.work_orders w
  where w.id = p_work_order_id;
$$;

-- Verification: a job whose document lists no materials
--   select public.wo_colours_confirmed('<that id>');   -> true (was false)
-- A job with materials still TBC
--   select public.wo_colours_confirmed('<that id>');   -> false
