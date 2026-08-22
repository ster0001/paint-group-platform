-- =============================================================================
-- QA standards as tickable lines
--
-- wo_record_qa took a pass/fail and a note. The lifecycle mockup shows the
-- check itself as a list of standards the inspector works through — cut lines,
-- coverage, prep evidence, site — so the record says WHAT was looked at, not
-- just that somebody looked.
--
-- A pass now requires every standard ticked. A fail does not: the point of a
-- fail is to record what was wrong and get it back to the painter.
-- =============================================================================

create table if not exists public.wo_qa_items (
  id            uuid primary key default gen_random_uuid(),
  qa_check_id   uuid not null references public.wo_qa_checks (id) on delete cascade,
  label         text not null,
  detail        text not null default '',
  sort          integer not null default 0,
  done_at       timestamptz,
  done_by       uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (qa_check_id, label)
);
create index if not exists wo_qa_items_check_idx on public.wo_qa_items (qa_check_id, sort);

alter table public.wo_qa_items enable row level security;

drop policy if exists wo_qa_items_staff on public.wo_qa_items;
create policy wo_qa_items_staff on public.wo_qa_items
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- The contractor sees what they were marked against; nobody but staff writes.
drop policy if exists wo_qa_items_contractor on public.wo_qa_items;
create policy wo_qa_items_contractor on public.wo_qa_items
  for select to authenticated using (
    exists (select 1 from public.wo_qa_checks c
             where c.id = wo_qa_items.qa_check_id
               and public.wo_is_my_job_as_contractor(c.work_order_id))
  );

grant select on public.wo_qa_items to authenticated;
revoke insert, update, delete on public.wo_qa_items from authenticated;

-- ---- the standards ----------------------------------------------------------
create or replace function public.wo_seed_qa_items(p_check_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_made integer := 0; v_i record;
begin
  if not exists (select 1 from public.wo_qa_checks where id = p_check_id) then return 0; end if;

  for v_i in
    select * from (values
      ('Cut lines',     'Straight to the eye at 1.5 m', 1),
      ('Coverage',      'No misses under raking light, laps even', 2),
      ('Prep evidence', 'Sanded edges feathered, gaps caulked', 3),
      ('Site',          'Overspray checks on glass, paths clean', 4)
    ) as t(label, detail, sort)
  loop
    if not exists (select 1 from public.wo_qa_items where qa_check_id = p_check_id and label = v_i.label) then
      insert into public.wo_qa_items (qa_check_id, label, detail, sort)
        values (p_check_id, v_i.label, v_i.detail, v_i.sort);
      v_made := v_made + 1;
    end if;
  end loop;
  return v_made;
end $$;

-- Seed the moment a check exists, whoever created it.
create or replace function public.wo_qa_items_on_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.wo_seed_qa_items(new.id);
  return new;
end $$;

drop trigger if exists wo_qa_checks_seed_items on public.wo_qa_checks;
create trigger wo_qa_checks_seed_items
  after insert on public.wo_qa_checks
  for each row execute function public.wo_qa_items_on_check();

create or replace function public.wo_tick_qa_item(p_item_id uuid, p_done boolean default true)
returns text language plpgsql security definer set search_path = public as $$
declare v_i public.wo_qa_items%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v_i from public.wo_qa_items where id = p_item_id for update;
  if not found then return 'error:not_found'; end if;

  update public.wo_qa_items
     set done_at = case when p_done then now() else null end,
         done_by = case when p_done then auth.uid() else null end
   where id = p_item_id;

  return 'ok:' || case when p_done then 'done' else 'undone' end;
end $$;
grant execute on function public.wo_tick_qa_item(uuid, boolean) to authenticated;

-- ---- a pass has to have looked at everything --------------------------------
create or replace function public.wo_qa_outstanding(p_check_id uuid)
returns integer language sql stable set search_path = public as $$
  select count(*)::integer from public.wo_qa_items
   where qa_check_id = p_check_id and done_at is null;
$$;
grant execute on function public.wo_qa_outstanding(uuid) to authenticated;

-- Backfill: existing checks get their standards.
do $$
declare v_id uuid;
begin
  for v_id in select id from public.wo_qa_checks loop
    perform public.wo_seed_qa_items(v_id);
  end loop;
end $$;

select c.id, count(i.id) as standards
  from public.wo_qa_checks c left join public.wo_qa_items i on i.qa_check_id = c.id
 group by c.id;
