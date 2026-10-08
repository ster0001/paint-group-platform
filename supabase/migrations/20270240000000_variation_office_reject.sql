-- =============================================================================
-- PC Command, Tom 8 Oct 2026 — the office rejects a painter's variation.
--
-- "In variations (PC Command), a button needs to be added to reject a
-- variation, with a reply box which sends a message back to the contractor."
--
--   wo_office_reject_variation(p_variation_id, p_note)   NEW, staff-only.
--     A request still WITH THE OFFICE ('raised') goes to 'declined' with the
--     office's reply on the row: office_rejected_at / _by / office_reject_note,
--     and declined_reason = the reply (the employee read, employee_variations,
--     already shows declined_reason as "The office says: …"). Anything past
--     'raised' answers error:not_raised — a priced change is the customer's to
--     answer, and an approved one is the painter's. A second press on a row the
--     office already rejected answers ok:already. Event
--     'variation_office_rejected' carries the reply. The message to the painter
--     (text + email) is sent by the server action and its outcome recorded as
--     'variation_rejected_notified' / '_skipped' — the app side.
--
-- No new table, no new policy: wo_variations' existing policies cover the new
-- columns (the painter reads their own job's rows already).
-- Converges on a re-run: add column if not exists, or-replace, idempotent grant.
-- =============================================================================
set lock_timeout = '15s';

alter table public.wo_variations
  add column if not exists office_rejected_at timestamptz,
  add column if not exists office_rejected_by uuid references auth.users (id) on delete set null,
  add column if not exists office_reject_note text not null default '';

-- The FK gets its index (house rule), partial: almost every row is null.
create index if not exists wo_variations_office_rejected_by_idx
  on public.wo_variations (office_rejected_by) where office_rejected_by is not null;

create or replace function public.wo_office_reject_variation(p_variation_id uuid, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare v_v public.wo_variations%rowtype; v_note text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  v_note := left(trim(coalesce(p_note, '')), 1000);
  if length(v_note) < 3 then return 'error:note_required'; end if;

  select * into v_v from public.wo_variations where id = p_variation_id for update;
  if not found then return 'error:not_found'; end if;

  if v_v.status = 'declined' and v_v.office_rejected_at is not null then return 'ok:already'; end if;
  if v_v.status <> 'raised' then return 'error:not_raised'; end if;

  update public.wo_variations
     set status = 'declined', declined_at = now(), declined_reason = v_note,
         office_rejected_at = now(), office_rejected_by = auth.uid(), office_reject_note = v_note
   where id = p_variation_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_v.work_order_id, 'variation_office_rejected', auth.uid(), 'staff',
            jsonb_build_object('variation_id', p_variation_id, 'note', v_note,
                               'raised_kind', v_v.raised_kind, 'hours', v_v.est_hours));
  return 'ok:declined';
end $$;
-- Explicit, not left to default privileges: the C1 read-back showed anon could
-- execute it when the paste ran as a role 20270201's defaults don't cover.
revoke execute on function public.wo_office_reject_variation(uuid, text) from public, anon;
grant execute on function public.wo_office_reject_variation(uuid, text) to authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ ---------------------------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'wo_variations'
     and column_name in ('office_rejected_at', 'office_rejected_by', 'office_reject_note')) as reject_columns, 3 as _expect_reject_columns,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'wo_variations_office_rejected_by_idx') as reject_index, 1 as _expect_reject_index,
  (select prosecdef from pg_proc where proname = 'wo_office_reject_variation') as reject_definer, true as _expect_reject_definer,
  (select has_function_privilege('authenticated', 'public.wo_office_reject_variation(uuid, text)', 'execute')) as reject_granted, true as _expect_reject_granted,
  (select has_function_privilege('anon', 'public.wo_office_reject_variation(uuid, text)', 'execute')) as anon_can_reject, false as _expect_anon_can_reject;

insert into public._prod_migrations(name) values ('20270240000000_variation_office_reject.sql') on conflict (name) do nothing;
