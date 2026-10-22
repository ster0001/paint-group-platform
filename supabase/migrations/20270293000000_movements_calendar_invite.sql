-- =============================================================================
-- Movements (Tom, 22 Oct 2026): a calendar invitation to the worker when a movement goes
-- onto their day. After the office drops a chip on a person and confirms the day and time in
-- the box, the server emails that person an .ics invitation (the automation
-- movement_calendar_invite). The movement records when it was last invited and a SEQUENCE
-- that climbs with every re-send, so a moved stop EDITS the entry in their calendar instead
-- of adding a second one. movement_record_invite is service-only: no client calls it.
-- Converging.
-- =============================================================================
set lock_timeout = '15s';

alter table public.movements add column if not exists invite_sent_at timestamptz;
alter table public.movements add column if not exists invite_sequence integer not null default 0;

create or replace function public.movement_record_invite(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype;
begin
  select * into m from public.movements where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  update public.movements set invite_sent_at = now(), invite_sequence = invite_sequence + 1 where id = p_id;
  perform public.movements_event(m.work_order_id, 'movement_invited', jsonb_build_object('movement_id', p_id, 'sequence', m.invite_sequence + 1, 'assignee_kind', m.assignee_kind::text, 'assignee_id', m.assignee_id));
  return 'ok:' || (m.invite_sequence + 1);
end $$;
revoke all on function public.movement_record_invite(uuid) from public, authenticated, anon;

-- ---- read-back: compare to the _expect_ values before calling this live ------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'movements' and column_name in ('invite_sent_at', 'invite_sequence')) as invite_columns, 2 as _expect_invite_columns,
  has_function_privilege('authenticated', 'public.movement_record_invite(uuid)', 'execute') as record_invite_client_callable, false as _expect_record_invite_client_callable,
  has_function_privilege('service_role', 'public.movement_record_invite(uuid)', 'execute') as record_invite_service_callable, true as _expect_record_invite_service_callable;

insert into public._prod_migrations(name) values ('20270293000000_movements_calendar_invite.sql') on conflict (name) do nothing;
