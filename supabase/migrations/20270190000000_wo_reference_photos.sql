-- =============================================================================
-- Photos the office attaches to a job that is already out (Tom, 23 Sep 2026)
--
-- "how do i attach photos to an accepted job so the contractors can see in
--  their work order?" … "we need to add photos to all the jobs coming in from
--  paint scout."
--
-- There was no way. The job sheet's photos are wo_snapshot.areas[].photos,
-- frozen from the accepted estimate (20260901 on accept, 20260904 on issue)
-- and unreachable afterwards — the same wall as the level of finish (20270189).
-- work_order photos DID exist, but neither contractor surface was ever passed
-- them: /portal/jobs/[id] and /w/[token] both render WorkOrderDoc with no
-- `photos` prop, while the staff builder's job-sheet tab DOES. So a photo
-- added after acceptance looked attached on the office's screen and was
-- invisible to the painter. On a PaintScout handover — where the estimate
-- carries no photos at all — there was nothing to show them, ever.
--
-- 'reference' is a photo that TELLS the painter something: the elevation the
-- scaffold goes on, where the gear lives, the colour to match. It is not part
-- of their record of the work (before / progress / qa / completion), so it is
-- its own kind rather than a caption convention on an existing one — the job
-- sheet groups by kind, and the painter's record must stay theirs.
--
-- Staff-only at the DATABASE, not merely absent from the contractor's screen:
-- wo_record_photo is granted to every authenticated caller and lets a
-- contractor write their own kinds, so a separate function carries the staff
-- gate. Deletion is likewise scoped to 'reference' alone — the office must
-- never be able to delete the painter's own evidence through this door.
--
-- Reads need nothing new: wo_photo_access(work_order_id) already gates both the
-- row and the object for staff, the assigned contractor and the job's customer,
-- and it asks about the WORK ORDER, not the kind.
-- =============================================================================

set lock_timeout = '15s';

-- ---- 1. the new kind --------------------------------------------------------
-- Postgres refuses to USE a new enum value in the transaction that adds it, so
-- this is deliberately the first statement and nothing below reads it at plan
-- time (the functions resolve their literals at run time). If your editor wraps
-- the whole paste in one transaction and this errors, run this line ALONE first,
-- then the rest.
alter type public.wo_photo_kind add value if not exists 'reference';

-- ---- 2. the office attaches one --------------------------------------------
create or replace function public.wo_record_reference_photo(
  p_work_order_id uuid,
  p_storage_path text,
  p_area text default '',
  p_caption text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_id uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage = 'closed' then return 'error:closed'; end if;
  if coalesce(trim(p_storage_path), '') = '' then return 'error:no_path'; end if;

  insert into public.wo_photos (work_order_id, area, kind, storage_path, caption, taken_by)
    values (p_work_order_id, coalesce(trim(p_area), ''), 'reference',
            trim(p_storage_path), coalesce(trim(p_caption), ''), auth.uid())
    returning id into v_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'reference_photo_added', auth.uid(), 'staff',
            jsonb_build_object('photo_id', v_id, 'area', coalesce(trim(p_area), ''),
                               'caption', coalesce(trim(p_caption), '')));

  return 'ok:' || v_id::text;
end $$;

-- ---- 3. and can take one back -----------------------------------------------
-- Scoped to 'reference'. A wrong photo on a painter's sheet needs removing, but
-- the painter's own before/progress/qa/completion record is evidence and is not
-- the office's to delete — so this refuses anything that is not ours.
create or replace function public.wo_delete_reference_photo(p_photo_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_p public.wo_photos%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_p from public.wo_photos where id = p_photo_id;
  if not found then return 'error:not_found'; end if;
  if v_p.kind <> 'reference' then return 'error:not_a_reference_photo'; end if;

  delete from public.wo_photos where id = p_photo_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_p.work_order_id, 'reference_photo_removed', auth.uid(), 'staff',
            jsonb_build_object('photo_id', p_photo_id, 'area', v_p.area,
                               'storage_path', v_p.storage_path));

  return 'ok';
end $$;

-- ---- 4. the painter's own token sheet can read them -------------------------
-- /w/[token] is ANONYMOUS: the anon key has no select on work_orders or
-- wo_photos, by design. Same pattern as get_work_order_by_token — the token is
-- the only key, the function returns ONLY the office's own photos for that
-- work order, and only while it is issued. It returns storage PATHS, never
-- URLs; the server signs them after this has said which paths are allowed.
create or replace function public.get_work_order_office_photos_by_token(p_token text)
returns table (id uuid, area text, caption text, storage_path text, created_at timestamptz)
language sql security definer set search_path = public as $$
  select p.id, p.area, p.caption, p.storage_path, p.created_at
    from public.wo_photos p
    join public.work_orders w on w.id = p.work_order_id
   where w.share_token = p_token
     and w.issued_at is not null
     -- `kind::text` deliberately: a LANGUAGE SQL body is planned when the
     -- function is created, and Postgres refuses to plan a comparison against
     -- an enum value added in the same transaction ("unsafe use of new value").
     -- The plpgsql functions above are planned lazily and can use it directly.
     and p.kind::text = 'reference'
   order by p.created_at;
$$;
grant execute on function public.get_work_order_office_photos_by_token(text) to anon, authenticated;

revoke execute on function public.wo_record_reference_photo(uuid, text, text, text) from public, anon;
grant  execute on function public.wo_record_reference_photo(uuid, text, text, text) to authenticated;
revoke execute on function public.wo_delete_reference_photo(uuid) from public, anon;
grant  execute on function public.wo_delete_reference_photo(uuid) to authenticated;

-- ---- Read-back (compare to the _expect_ values before using the screen) -----
select
  (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'wo_photo_kind' and e.enumlabel = 'reference') as kind_present,
  1 as _expect_kind_present,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('wo_record_reference_photo', 'wo_delete_reference_photo',
                    'get_work_order_office_photos_by_token')) as fns,
  3 as _expect_fns,
  (select bool_and(prosecdef) from pg_proc where pronamespace = 'public'::regnamespace
    and proname in ('wo_record_reference_photo', 'wo_delete_reference_photo',
                    'get_work_order_office_photos_by_token')) as all_security_definer,
  true as _expect_all_security_definer,
  (select has_function_privilege('anon', oid, 'execute') from pg_proc
    where proname = 'get_work_order_office_photos_by_token'
      and pronamespace = 'public'::regnamespace) as anon_may_read_by_token,
  true as _expect_anon_may_read_by_token,
  (select has_function_privilege('anon', oid, 'execute') from pg_proc
    where proname = 'wo_record_reference_photo' and pronamespace = 'public'::regnamespace) as anon_may_record,
  false as _expect_anon_may_record,
  (select has_function_privilege('authenticated', oid, 'execute') from pg_proc
    where proname = 'wo_record_reference_photo' and pronamespace = 'public'::regnamespace) as authenticated_may_record,
  true as _expect_authenticated_may_record;

insert into public._prod_migrations(name) values ('20270190000000_wo_reference_photos.sql') on conflict (name) do nothing;
