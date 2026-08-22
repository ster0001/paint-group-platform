-- =====================================================================
-- Crew link — the contractor shares the job sheet with their painters.
--
-- A SECOND token on the work order, deliberately not the share_token. The
-- contractor's own link is their contract — it shows their payment. The
-- crew link renders the same document with the money and the customer's
-- phone stripped ON THE SERVER (lib/workorder/crew.ts), so what a painter
-- forwards on contains nothing worth minding.
--
-- The token is minted LAZILY, by the contractor pressing "Share with your
-- crew" — not at acceptance. That keeps this file away from
-- accept_estimate(), which 20261026 (invoicing) only just rewrote; two
-- migrations replacing one function body in the same week is how a
-- regression sneaks in. Rotating mints a fresh token, and the old link
-- dies with it — a painter who leaves the crew loses the job sheet.
--
-- View-only by design: there is no crew tick RPC. Ticks stay with the
-- contractor, whose name is on the accountability trail.
-- =====================================================================

alter table public.work_orders
  add column if not exists crew_token text unique;

-- ---- mint / rotate: the assigned contractor or staff, nobody else -----

create or replace function public.get_or_create_crew_token(p_work_order_id uuid, p_rotate boolean default false)
returns text language plpgsql security definer set search_path = public as $$
declare v_w public.work_orders%rowtype; v_cid uuid;
begin
  select * into v_w from public.work_orders where id = p_work_order_id for update;
  if not found then return 'error:not_found'; end if;
  if v_w.issued_at is null then return 'error:not_issued'; end if;

  v_cid := public.current_contractor_id();
  if not (public.is_staff() or (v_cid is not null and v_cid = v_w.contractor_id)) then
    return 'error:not_yours';
  end if;

  if v_w.crew_token is null or p_rotate then
    update public.work_orders
       set crew_token = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
     where id = p_work_order_id
     returning crew_token into v_w.crew_token;
  end if;

  return 'ok:' || v_w.crew_token;
end $$;
grant execute on function public.get_or_create_crew_token(uuid, boolean) to authenticated;

-- ---- reads, keyed by the crew token -----------------------------------
-- Same shape as get_work_order_by_token. The RAW snapshot comes back —
-- the whitelist strip happens in the server component, in one audited
-- place, rather than half here and half there.

create or replace function public.get_work_order_by_crew_token(p_token text)
returns table (wo_ref text, status public.wo_status, snapshot jsonb, start_date date)
language sql security definer set search_path = public as $$
  select w.wo_ref, w.status, w.wo_snapshot, w.start_date
  from public.work_orders w
  where w.crew_token = p_token and w.issued_at is not null
  limit 1;
$$;
grant execute on function public.get_work_order_by_crew_token(text) to anon, authenticated;

create or replace function public.get_work_order_ticks_by_crew_token(p_token text)
returns table (surface_key text, state public.wo_surface_state)
language sql security definer set search_path = public as $$
  select s.surface_key, s.state
    from public.wo_surfaces s
    join public.work_orders w on w.id = s.work_order_id
   where w.crew_token = p_token
     and w.issued_at is not null
     and s.surface_key is not null;
$$;
grant execute on function public.get_work_order_ticks_by_crew_token(text) to anon, authenticated;

-- Variations: the SCOPE, never the money. price_cents and
-- contractor_delta_cents are not in the return type, so no caller of this
-- function can leak them. Declined ones stay out — they are not work.
create or replace function public.get_work_order_variations_by_crew_token(p_token text)
returns table (category text, comment text, est_hours numeric, status text)
language sql security definer set search_path = public as $$
  select v.category, v.comment, v.est_hours, v.status::text
    from public.wo_variations v
    join public.work_orders w on w.id = v.work_order_id
   where w.crew_token = p_token
     and w.issued_at is not null
     and v.status <> 'declined'
   order by v.created_at;
$$;
grant execute on function public.get_work_order_variations_by_crew_token(text) to anon, authenticated;

-- ---- Verification -----------------------------------------------------
-- Expect 4 rows, all security_definer = true.
select p.proname, p.prosecdef as security_definer
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('get_or_create_crew_token', 'get_work_order_by_crew_token',
                     'get_work_order_ticks_by_crew_token', 'get_work_order_variations_by_crew_token')
 order by p.proname;
-- Expect 1 row: the crew_token column exists.
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'work_orders' and column_name = 'crew_token';
