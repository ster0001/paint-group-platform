-- Customer updates carry the photos the office attached (14 Oct 2026).
--
-- The job page composer let the office pick up to 8 site photos for an
-- update; they rode in the email only. Nothing recorded WHICH photos belonged
-- to the update, so the customer portal timeline drew the update card with
-- the photos taken on the day it was sent, not the ones the office chose.
-- Now wo_send_update takes the chosen ids, keeps only those that belong to
-- the same job, and stores them on the row; the portal reads them back.
-- Converges on a re-run.
set lock_timeout = '15s';

alter table public.wo_updates
  add column if not exists photo_ids uuid[] not null default '{}';
comment on column public.wo_updates.photo_ids is
  'wo_photos ids the office attached when sending. Scoped to the same job by wo_send_update.';

drop function if exists public.wo_send_update(uuid);

create or replace function public.wo_send_update(p_update_id uuid, p_photo_ids uuid[] default '{}')
returns text language plpgsql security definer set search_path = public as $$
declare
  v_u public.wo_updates%rowtype;
  v_photos uuid[];
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_u from public.wo_updates where id = p_update_id for update;
  if not found then return 'error:not_found'; end if;
  if v_u.status = 'sent' then return 'ok:already'; end if;
  if v_u.status <> 'approved' then return 'error:not_approved'; end if;

  -- Only photos of THIS job, at most 8, in the order they were chosen.
  select coalesce(array_agg(p.id order by ord), '{}'::uuid[]) into v_photos
    from unnest(coalesce(p_photo_ids, '{}'::uuid[])) with ordinality as chosen(id, ord)
    join public.wo_photos p on p.id = chosen.id
   where p.work_order_id = v_u.work_order_id
     and ord <= 8;

  update public.wo_updates
     set status = 'sent',
         sent_at = now(),
         photo_ids = v_photos,
         photo_count = greatest(photo_count, coalesce(array_length(v_photos, 1), 0))
   where id = p_update_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_u.work_order_id, 'update_sent', auth.uid(), 'staff',
            jsonb_build_object('update_id', p_update_id, 'for_date', v_u.for_date,
                               'photo_count', coalesce(array_length(v_photos, 1), 0)));

  return 'ok:sent';
end $$;

grant execute on function public.wo_send_update(uuid, uuid[]) to authenticated;

-- Read-back: compare to the _expect_ values before calling this live.
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'wo_updates' and column_name = 'photo_ids') as photo_ids_column,
  1 as _expect_photo_ids_column,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_send_update') as send_update_overloads,
  1 as _expect_send_update_overloads,
  (select has_function_privilege('authenticated', 'public.wo_send_update(uuid, uuid[])', 'execute')) as authenticated_can_send,
  true as _expect_authenticated_can_send;

insert into public._prod_migrations(name) values ('20270268000000_update_photos.sql') on conflict (name) do nothing;
