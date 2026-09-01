-- Tom's 1 Sep batch #2: fuel / consumables have no colour — they never belong
-- in the colour-match list, and must never gate the pack. Body copied from
-- 20261110 verbatim + the one name filter (ColourMatchCard applies the same
-- regex client-side so the screen and the gate agree — the house rule).

create or replace function public.wo_colour_match_outstanding(p_work_order_id uuid)
returns text language sql stable set search_path = public as $$
  with w as (
    select wo_snapshot, colours,
           exists (select 1 from public.wo_checklist_items i
                    where i.work_order_id = p_work_order_id and i.phase = 'pre_start'
                      and i.item_key = 'colours' and i.answer = 'no') as colours_no
      from public.work_orders where id = p_work_order_id
  ),
  m as (
    select x->>'product' as product,
           coalesce((x->'colourMatch'->>'required')::boolean, false) as flagged,
           coalesce(x->>'colourName', '') as colour,
           coalesce(x->'colourMatch'->>'code', '') as snap_code,
           coalesce(w.colours -> (x->>'product') -> 'match' ->> 'code', '') as wo_code,
           w.colours_no
      from w, jsonb_array_elements(coalesce(w.wo_snapshot->'materials', '[]'::jsonb)) x
  )
  select coalesce(string_agg(product, ', ' order by product), '')
    from m
   where (flagged or (colours_no and colour = ''))
     and snap_code = '' and wo_code = ''
     -- nothing colourable about fuel or consumables
     and product !~* '(fuel|consumable)';
$$;
grant execute on function public.wo_colour_match_outstanding(uuid) to authenticated, service_role;

-- ---- readback -------------------------------------------------------------
-- Expect: fuel_filtered = true.
select position('fuel' in pg_get_functiondef(
  (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_colour_match_outstanding'))) > 0 as fuel_filtered;
