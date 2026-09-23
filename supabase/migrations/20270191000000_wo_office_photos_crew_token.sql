-- =============================================================================
-- Office photos on the CREW link (Tom, 23 Sep 2026): "the contractor needs to
-- see them."
--
-- 20270190 put the office's reference photos on the portal job page and the
-- contractor's /w/[token] sheet, and missed the third painter-facing surface:
-- /crew/[token], the link a contractor mints and hands to their own painters.
-- Same trust ladder as get_work_order_by_crew_token — anonymous, the crew
-- token is the only key, only while issued, only the office's own photos,
-- and storage PATHS that the server signs afterwards. A reference photo is an
-- instruction about the work (which elevation, where the gear lives), which
-- is exactly what the crew whitelist exists to carry — never money, never the
-- customer's contact.
-- =============================================================================

set lock_timeout = '15s';

create or replace function public.get_work_order_office_photos_by_crew_token(p_token text)
returns table (id uuid, area text, caption text, storage_path text, created_at timestamptz)
language sql security definer set search_path = public as $$
  select p.id, p.area, p.caption, p.storage_path, p.created_at
    from public.wo_photos p
    join public.work_orders w on w.id = p.work_order_id
   where w.crew_token = p_token
     and w.issued_at is not null
     -- kind::text, as in 20270190: safe to plan even on a database where the
     -- enum value was added in this same paste.
     and p.kind::text = 'reference'
   order by p.created_at;
$$;
grant execute on function public.get_work_order_office_photos_by_crew_token(text) to anon, authenticated;

-- ---- Read-back (compare to the _expect_ values) -----------------------------
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
    and proname = 'get_work_order_office_photos_by_crew_token') as fn_present,
  1 as _expect_fn_present,
  (select prosecdef from pg_proc where pronamespace = 'public'::regnamespace
    and proname = 'get_work_order_office_photos_by_crew_token') as security_definer,
  true as _expect_security_definer,
  (select has_function_privilege('anon', oid, 'execute') from pg_proc
    where proname = 'get_work_order_office_photos_by_crew_token'
      and pronamespace = 'public'::regnamespace) as anon_may_read_by_crew_token,
  true as _expect_anon_may_read_by_crew_token;

insert into public._prod_migrations(name) values ('20270191000000_wo_office_photos_crew_token.sql') on conflict (name) do nothing;
