-- =============================================================================
-- 20270243 · PC Command: pre-start materials/equipment lists + reminder notes
-- (Tom, 8 Oct 2026)
--
-- 1. wo_prestart_lists — one row per job: everything the job needs in
--    materials and in equipment, written in the pre-start view under the
--    "Materials ordered" / "Equipment movements booked" items. A REFERENCE,
--    saved whenever the office likes — it never ticks, unticks or gates the
--    checklist (the ticks stay the gate, wo_gate_blocked is untouched).
--
-- 2. work_item_notes — a short note on a dashboard reminder, keyed by the
--    reminder's deterministic key (the same key DismissCard / work_item_
--    dismissals use: `colours:<wo id>`, `job_checkin:work_order:<id>:…`).
--    Work items are still DERIVED, never stored: this table holds the office's
--    words ABOUT a key, exactly as work_item_dismissals holds a suppression of
--    one. A key whose fact goes away simply stops being drawn; its note is
--    inert. Empty note = the row is deleted.
--
-- Staff only, both. A painter's session reads nothing (no policy for them);
-- writes go only through the two staff-checked definer functions below.
--
-- Converges on a re-run. Paste starts with a lock timeout.
-- =============================================================================
set lock_timeout = '15s';

-- ---- 1. the pre-start lists ------------------------------------------------------
create table if not exists public.wo_prestart_lists (
  work_order_id uuid primary key references public.work_orders (id) on delete cascade,
  materials     text not null default '',
  equipment     text not null default '',
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id) on delete set null,
  constraint wo_prestart_lists_materials_len check (char_length(materials) <= 4000),
  constraint wo_prestart_lists_equipment_len check (char_length(equipment) <= 4000)
);
-- work_order_id is the primary key, so its FK is already indexed.
create index if not exists wo_prestart_lists_updated_by_idx on public.wo_prestart_lists (updated_by) where updated_by is not null;

alter table public.wo_prestart_lists enable row level security;
drop policy if exists wo_prestart_lists_staff_read on public.wo_prestart_lists;
create policy wo_prestart_lists_staff_read on public.wo_prestart_lists
  for select to authenticated using (public.is_staff());
revoke all on public.wo_prestart_lists from anon;
revoke insert, update, delete on public.wo_prestart_lists from authenticated;
grant select on public.wo_prestart_lists to authenticated;

create or replace function public.wo_set_prestart_list(p_work_order_id uuid, p_kind text, p_text text)
returns text language plpgsql security definer set search_path = public as $$
declare v_text text := coalesce(trim(p_text), '');
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_kind not in ('materials', 'equipment') then return 'error:unknown_list'; end if;
  if char_length(v_text) > 4000 then return 'error:too_long'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then return 'error:not_found'; end if;

  insert into public.wo_prestart_lists as l (work_order_id, materials, equipment, updated_at, updated_by)
  values (p_work_order_id,
          case when p_kind = 'materials' then v_text else '' end,
          case when p_kind = 'equipment' then v_text else '' end,
          now(), auth.uid())
  on conflict (work_order_id) do update
     set materials  = case when p_kind = 'materials' then v_text else l.materials end,
         equipment  = case when p_kind = 'equipment' then v_text else l.equipment end,
         updated_at = now(),
         updated_by = auth.uid();
  return 'ok:saved';
end $$;
revoke all on function public.wo_set_prestart_list(uuid, text, text) from public, anon;
grant execute on function public.wo_set_prestart_list(uuid, text, text) to authenticated;

-- ---- 2. notes on reminders --------------------------------------------------------
create table if not exists public.work_item_notes (
  item_key   text primary key,
  note       text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint work_item_notes_key_len check (char_length(item_key) between 1 and 200),
  constraint work_item_notes_note_len check (char_length(note) between 1 and 280)
);
comment on table public.work_item_notes is
  'Tom, 8 Oct 2026. A short office note on a dashboard reminder, keyed by the derived work-item / card key. Not a work_items table: the reminder itself is never stored. Written only through pc_set_work_item_note().';
create index if not exists work_item_notes_updated_by_idx on public.work_item_notes (updated_by) where updated_by is not null;

alter table public.work_item_notes enable row level security;
drop policy if exists work_item_notes_staff_read on public.work_item_notes;
create policy work_item_notes_staff_read on public.work_item_notes
  for select to authenticated using (public.is_staff());
revoke all on public.work_item_notes from anon;
revoke insert, update, delete on public.work_item_notes from authenticated;
grant select on public.work_item_notes to authenticated;

create or replace function public.pc_set_work_item_note(p_item_key text, p_note text)
returns text language plpgsql security definer set search_path = public as $$
declare v_note text := coalesce(trim(p_note), '');
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_item_key is null or char_length(p_item_key) not between 1 and 200 then return 'error:bad_key'; end if;
  if char_length(v_note) > 280 then return 'error:too_long'; end if;
  if v_note = '' then
    delete from public.work_item_notes where item_key = p_item_key;
    return 'ok:cleared';
  end if;
  insert into public.work_item_notes (item_key, note, updated_at, updated_by)
  values (p_item_key, v_note, now(), auth.uid())
  on conflict (item_key) do update set note = excluded.note, updated_at = now(), updated_by = auth.uid();
  return 'ok:saved';
end $$;
revoke all on function public.pc_set_work_item_note(text, text) from public, anon;
grant execute on function public.pc_set_work_item_note(text, text) to authenticated;

-- ---- read-back: compare to the _expect_ columns before calling this live ----------
select
  (select count(*) from information_schema.tables where table_schema = 'public'
     and table_name in ('wo_prestart_lists', 'work_item_notes')) as tables_made, 2 as _expect_tables,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
     and c.relname in ('wo_prestart_lists', 'work_item_notes') and c.relrowsecurity) as rls_on, 2 as _expect_rls,
  (select count(*) from pg_policies where schemaname = 'public'
     and tablename in ('wo_prestart_lists', 'work_item_notes')) as policies, 2 as _expect_policies,
  has_table_privilege('authenticated', 'public.work_item_notes', 'insert') as auth_can_insert_notes, false as _expect_no_insert_notes,
  has_table_privilege('authenticated', 'public.wo_prestart_lists', 'update') as auth_can_update_lists, false as _expect_no_update_lists,
  has_function_privilege('authenticated', 'public.wo_set_prestart_list(uuid, text, text)', 'execute') as lists_rpc_granted, true as _expect_lists_rpc,
  has_function_privilege('authenticated', 'public.pc_set_work_item_note(text, text)', 'execute') as notes_rpc_granted, true as _expect_notes_rpc,
  has_function_privilege('anon', 'public.pc_set_work_item_note(text, text)', 'execute') as anon_notes_rpc, false as _expect_no_anon;

insert into public._prod_migrations(name) values ('20270243000000_pc_prestart_lists_and_work_item_notes.sql') on conflict (name) do nothing;
