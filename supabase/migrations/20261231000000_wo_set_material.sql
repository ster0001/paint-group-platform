-- =============================================================================
-- Materials on the PC job page (Tom, 4 Sep 2026)
--
-- "In the PC Dashboard, when clicking into a project, create a materials
-- section which has all of the breakdown of colours for each substrate which
-- can be adjusted or edited in the PC View."
--
-- The job sheet (work_orders.wo_snapshot) is frozen at issue and its column
-- is server-owned — staff cannot update it directly (20260902 revoked the
-- column). Colours are what the office adjusts after issue (a customer settles
-- on Natural White instead of Vivid White; the painter needs 15 L not 10), and
-- the painter's sheet, the portal job page and the colour register all read
-- the snapshot — so an edit has to land THERE, not only in the live colours
-- map, or the painter keeps seeing the old colour.
--
-- wo_set_material rewrites ONE material row (identity = colourKey, or the bare
-- product on pre-split documents) and every surface that carries that key,
-- and mirrors name/hex/status into work_orders.colours the way the builder's
-- work-order tab does (same key, same shape) so both readers agree.
-- Staff-only; refuses a closed job. Idempotent, safe to re-run.
-- =============================================================================

create or replace function public.wo_set_material(
  p_work_order_id uuid,
  p_row_key text,
  p_colour_name text default '',
  p_colour_hex text default '',
  p_status text default 'tbc',
  p_litres numeric default null
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_wo public.work_orders%rowtype;
  v_mats jsonb; v_areas jsonb; v_found boolean;
  v_name text; v_hex text; v_product text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage = 'closed' then return 'error:closed'; end if;
  if coalesce(trim(p_row_key), '') = '' then return 'error:no_row'; end if;
  if p_status not in ('tbc', 'confirmed') then return 'error:bad_status'; end if;
  if p_litres is not null and (p_litres < 0 or p_litres > 10000) then return 'error:bad_litres'; end if;

  v_name := coalesce(trim(p_colour_name), '');
  v_hex  := coalesce(trim(p_colour_hex), '');
  if v_hex <> '' and v_hex !~ '^#[0-9A-Fa-f]{6}$' then return 'error:bad_hex'; end if;

  -- The material row: colourName / colourHex / colourStatus, and the order
  -- quantity when one was typed (a typed figure is never "coverage missing").
  select
    coalesce(jsonb_agg(
      case when coalesce(m ->> 'colourKey', m ->> 'product') = p_row_key then
        m || jsonb_build_object('colourName', v_name, 'colourHex', v_hex, 'colourStatus', p_status)
          || case when p_litres is null then '{}'::jsonb
                  else jsonb_build_object('litres', p_litres, 'coverageMissing', false) end
      else m end
      order by ord), '[]'::jsonb),
    coalesce(bool_or(coalesce(m ->> 'colourKey', m ->> 'product') = p_row_key), false)
  into v_mats, v_found
  from jsonb_array_elements(coalesce(v_wo.wo_snapshot -> 'materials', '[]'::jsonb))
       with ordinality as t(m, ord);
  if not v_found then return 'error:no_such_material'; end if;

  select m ->> 'product' into v_product
    from jsonb_array_elements(v_mats) m
   where coalesce(m ->> 'colourKey', m ->> 'product') = p_row_key
   limit 1;

  -- Every surface painted in that product×colour follows (the per-surface
  -- colour truth rides each doc surface since ruling 1, 30 Aug).
  select coalesce(jsonb_agg(
    a || jsonb_build_object('surfaces', (
      select coalesce(jsonb_agg(
        case when coalesce(s ->> 'colourKey', s ->> 'product') = p_row_key
             then s || jsonb_build_object('colourName', v_name, 'colourHex', v_hex)
             else s end
        order by sord), '[]'::jsonb)
      from jsonb_array_elements(coalesce(a -> 'surfaces', '[]'::jsonb))
           with ordinality as st(s, sord)))
    order by aord), '[]'::jsonb)
  into v_areas
  from jsonb_array_elements(coalesce(v_wo.wo_snapshot -> 'areas', '[]'::jsonb))
       with ordinality as at(a, aord);

  update public.work_orders
     set wo_snapshot = jsonb_set(jsonb_set(wo_snapshot, '{materials}', v_mats, true), '{areas}', v_areas, true),
         colours = coalesce(colours, '{}'::jsonb)
           || jsonb_build_object(p_row_key,
                coalesce(colours -> p_row_key, '{}'::jsonb)
                || jsonb_build_object('name', v_name, 'hex', v_hex, 'status', p_status))
   where id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'material_edited', auth.uid(), 'staff',
            jsonb_build_object('row_key', p_row_key, 'product', v_product,
                               'colour_name', v_name, 'colour_hex', v_hex,
                               'status', p_status, 'litres', p_litres));
  return 'ok';
end $$;

revoke execute on function public.wo_set_material(uuid, text, text, text, text, numeric) from public, anon;
grant execute on function public.wo_set_material(uuid, text, text, text, text, numeric) to authenticated;

-- ---- Read-back (paste the result in chat) -----------------------------------
select proname, pg_get_function_identity_arguments(oid) as args
  from pg_proc
 where proname = 'wo_set_material' and pronamespace = 'public'::regnamespace;
-- expect ONE row: wo_set_material | p_work_order_id uuid, p_row_key text,
--   p_colour_name text, p_colour_hex text, p_status text, p_litres numeric
