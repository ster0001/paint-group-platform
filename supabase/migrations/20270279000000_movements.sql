-- 20270279 · Movements — Session 1 of docs/briefs/movements-build-plan.md
-- (docs/briefs/claude-code-brief-pc-movements.md v2.2 §3.1, §5; Session 0 report item 9).
--
-- One record for the thing that moves: a chip IS a movements row. In the tray it
-- has status tray, no assignee and no day; dropping it on a lane fills the
-- assignee (supplier, or a person = staff profile or painter) and the day, and
-- the row follows the thing from needs-to-move to moved.
--
--   · enums movement_kind, movement_status, movement_assignee, place_kind,
--     branch_kind, equipment_category (the nine register types + other),
--     equipment_status.
--   · supplier_branches (hang off vendors by brand) + supplier_branch_accounts
--     (trade account refs, staff-only, never in the repo).
--   · equipment_items (tagged individually from equipment_tag_seq, ruling 1;
--     NO location column — location is derived from the last done movement).
--   · movements, movement_items, wo_material_lines (the materials list as
--     lines, three doors one list — ruling 17), wo_logistics_decisions.
--   · settings row movements with the §3.1 defaults; warehouse = the company
--     address from settings.company_profile (⚑1), boardPeople empty (⚑5).
--   · is_demo on every job-linked table, copied by trigger (demo wall).
--   · RLS: staff everything. Painters read through two definer functions,
--     movements_for_painter and supplier_branches_for_painter, which carry
--     the column limits of §5 — Postgres column privileges are per ROLE and
--     staff share the authenticated role, so a column grant cannot tell a
--     painter from the office; the function can. No painter policy on the
--     base tables, nothing for customers, nothing on accounts, items or
--     decisions.
--   · Every RPC of §5 except the three Session 7 redefinitions. Only RPCs
--     write movements.status (insert, update, delete revoked from clients).
--   · movements_sync_for_wo runs from a trigger on work_orders when the
--     Materials rows in wo_snapshot change, when the job is issued and when
--     it closes (stranded gear), and from the material line RPCs.
--
-- Converges on a re-run. No DO blocks (the SQL editor splitter); enums are
-- created inside a throwaway function with duplicate_object handlers.

set lock_timeout = '15s';

-- ---- 1. enums --------------------------------------------------------------------------------
create or replace function public.movements_ensure_types()
returns void language plpgsql as $$
begin
  begin
    create type public.movement_kind as enum
      ('paint', 'materials', 'equipment_out', 'equipment_return', 'hire_on', 'hire_off',
       'rubbish_in', 'rubbish_out', 'restock', 'repair_out', 'repair_back', 'other');
  exception when duplicate_object then null; end;
  begin
    create type public.movement_status as enum ('tray', 'planned', 'booked', 'done', 'problem', 'cancelled');
  exception when duplicate_object then null; end;
  begin
    create type public.movement_assignee as enum ('supplier', 'person');
  exception when duplicate_object then null; end;
  begin
    create type public.place_kind as enum ('branch', 'warehouse', 'site', 'person', 'tip', 'other');
  exception when duplicate_object then null; end;
  begin
    create type public.branch_kind as enum ('paint', 'hardware', 'hire', 'other');
  exception when duplicate_object then null; end;
  begin
    create type public.equipment_category as enum
      ('step_ladder', 'ext_ladder_7', 'ext_ladder_10', 'platform_ladder', 'spray_gun',
       'planex_sander', 'festool_vacuum', 'mobile_scaffold', 'fall_protection', 'other');
  exception when duplicate_object then null; end;
  begin
    create type public.equipment_status as enum ('active', 'repair', 'retired', 'lost');
  exception when duplicate_object then null; end;
end $$;
select public.movements_ensure_types();
drop function public.movements_ensure_types();

-- ---- 2. supplier branches + accounts ---------------------------------------------------------
create table if not exists public.supplier_branches (
  id               uuid primary key default gen_random_uuid(),
  vendor_id        uuid references public.vendors (id) on delete set null,
  brand            text not null check (char_length(btrim(brand)) between 1 and 80),
  branch           text not null check (char_length(btrim(branch)) between 1 and 80),
  kind             public.branch_kind not null default 'paint',
  address          text not null default '' check (char_length(address) <= 200),
  suburb           text not null default '' check (char_length(suburb) <= 80),
  postcode         text not null default '' check (postcode = '' or postcode ~ '^[0-9]{4}$'),
  phone            text not null default '' check (char_length(phone) <= 40),
  email            text not null default '' check (char_length(email) <= 200),
  map_place_id     text not null default '' check (char_length(map_place_id) <= 200),
  lat              double precision,
  lng              double precision,
  delivers_to_site boolean not null default false,
  opens_weekday    time,
  favourite        boolean not null default false,
  active           boolean not null default true,
  source_url       text not null default '' check (char_length(source_url) <= 400),
  notes            text not null default '' check (char_length(notes) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists supplier_branches_brand_branch_key
  on public.supplier_branches (lower(btrim(brand)), lower(btrim(branch)));
create index if not exists supplier_branches_vendor_idx on public.supplier_branches (vendor_id) where vendor_id is not null;
create index if not exists supplier_branches_active_idx on public.supplier_branches (kind, active);

create table if not exists public.supplier_branch_accounts (
  branch_id    uuid primary key references public.supplier_branches (id) on delete cascade,
  account_ref  text not null default '' check (char_length(account_ref) <= 80),
  account_name text not null default '' check (char_length(account_name) <= 120),
  updated_by   uuid references auth.users (id) on delete set null,
  updated_at   timestamptz not null default now()
);
create index if not exists supplier_branch_accounts_updated_by_idx on public.supplier_branch_accounts (updated_by) where updated_by is not null;

-- ---- 3. the equipment register ---------------------------------------------------------------
create sequence if not exists public.equipment_tag_seq;
create table if not exists public.equipment_items (
  id              uuid primary key default gen_random_uuid(),
  tag             text not null unique default ('E-' || lpad(nextval('public.equipment_tag_seq')::text, 3, '0')),
  name            text not null check (char_length(btrim(name)) between 1 and 120),
  category        public.equipment_category not null default 'other',
  serial_or_model text not null default '' check (char_length(serial_or_model) <= 120),
  notes           text not null default '' check (char_length(notes) <= 500),
  status          public.equipment_status not null default 'active',
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists equipment_items_status_idx on public.equipment_items (status, category);
create index if not exists equipment_items_created_by_idx on public.equipment_items (created_by) where created_by is not null;

-- ---- 4. movements ---------------------------------------------------------------------------
create table if not exists public.movements (
  id                     uuid primary key default gen_random_uuid(),
  work_order_id          uuid references public.work_orders (id) on delete cascade,
  kind                   public.movement_kind not null,
  source_key             text check (char_length(source_key) <= 120),
  title                  text not null default '' check (char_length(title) <= 160),
  detail                 text check (char_length(detail) <= 300),
  assignee_kind          public.movement_assignee,
  assignee_table         text check (assignee_table in ('profiles', 'contractors')),
  assignee_id            uuid,
  due_date               date,
  half                   text check (half in ('AM', 'PM')),
  time                   time,
  sequence               integer check (sequence is null or sequence >= 1),
  from_kind              public.place_kind,
  from_branch_id         uuid references public.supplier_branches (id) on delete set null,
  from_text              text not null default '' check (char_length(from_text) <= 200),
  to_kind                public.place_kind,
  to_branch_id           uuid references public.supplier_branches (id) on delete set null,
  to_text                text not null default '' check (char_length(to_text) <= 200),
  status                 public.movement_status not null default 'tray',
  ordered_at             timestamptz,
  ordered_by             uuid references auth.users (id) on delete set null,
  painter_alerted_at     timestamptz,
  client_notice          boolean not null default false,
  client_notified_at     timestamptz,
  order_ref              text not null default '' check (char_length(order_ref) <= 40),
  lines                  jsonb,
  planned_for_start      date,
  return_due             date,
  blocked_by_movement_id uuid references public.movements (id) on delete set null,
  expected_cost_cents    integer check (expected_cost_cents is null or expected_cost_cents >= 0),
  note                   text not null default '' check (char_length(note) <= 500),
  painter_visible        boolean not null default false,
  problem_note           text not null default '' check (char_length(problem_note) <= 500),
  painter_confirmed_at   timestamptz,
  source_changed_at      timestamptz,
  run_plan_sent_at       timestamptz,
  booked_at              timestamptz,
  booked_by              uuid references auth.users (id) on delete set null,
  done_at                timestamptz,
  done_by                uuid references auth.users (id) on delete set null,
  cancelled_at           timestamptz,
  cancelled_by           uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  created_by             uuid references auth.users (id) on delete set null,
  updated_at             timestamptz not null default now(),
  is_demo                boolean not null default false,
  constraint movements_assignee_shape check (
    (assignee_kind is null and assignee_id is null and assignee_table is null)
    or (assignee_kind = 'supplier' and assignee_id is null and assignee_table is null)
    or (assignee_kind = 'person' and assignee_id is not null and assignee_table is not null)),
  constraint movements_placed_shape check (
    status in ('tray', 'cancelled') or (assignee_kind is not null and due_date is not null)),
  constraint movements_tray_shape check (status <> 'tray' or assignee_kind is null)
);
create index if not exists movements_wo_idx on public.movements (work_order_id);
create index if not exists movements_day_idx on public.movements (due_date, status);
create index if not exists movements_assignee_idx on public.movements (assignee_kind, assignee_id, due_date);
create index if not exists movements_tray_idx on public.movements (status) where status = 'tray';
create unique index if not exists movements_source_key_key
  on public.movements (coalesce(work_order_id, '00000000-0000-0000-0000-000000000000'::uuid), source_key)
  where source_key is not null;
create index if not exists movements_blocked_by_idx on public.movements (blocked_by_movement_id) where blocked_by_movement_id is not null;
create index if not exists movements_from_branch_idx on public.movements (from_branch_id) where from_branch_id is not null;
create index if not exists movements_to_branch_idx on public.movements (to_branch_id) where to_branch_id is not null;
create index if not exists movements_ordered_by_idx on public.movements (ordered_by) where ordered_by is not null;
create index if not exists movements_booked_by_idx on public.movements (booked_by) where booked_by is not null;
create index if not exists movements_done_by_idx on public.movements (done_by) where done_by is not null;
create index if not exists movements_cancelled_by_idx on public.movements (cancelled_by) where cancelled_by is not null;
create index if not exists movements_created_by_idx on public.movements (created_by) where created_by is not null;

create table if not exists public.movement_items (
  movement_id       uuid not null references public.movements (id) on delete cascade,
  equipment_item_id uuid not null references public.equipment_items (id) on delete restrict,
  label             text not null default '' check (char_length(label) <= 160),
  is_demo           boolean not null default false,
  primary key (movement_id, equipment_item_id)
);
create index if not exists movement_items_item_idx on public.movement_items (equipment_item_id);

-- ---- 5. material lines + decisions ---------------------------------------------------------
create table if not exists public.wo_material_lines (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  text          text not null check (char_length(btrim(text)) between 1 and 200),
  source        text not null default 'pc' check (source in ('estimate', 'pc', 'painter_request')),
  request_id    uuid references public.wo_material_requests (id) on delete set null,
  sort          integer not null default 0,
  merged_into   uuid references public.wo_material_lines (id) on delete set null,
  created_by    uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  is_demo       boolean not null default false
);
create index if not exists wo_material_lines_wo_idx on public.wo_material_lines (work_order_id, sort);
create index if not exists wo_material_lines_request_idx on public.wo_material_lines (request_id) where request_id is not null;
create index if not exists wo_material_lines_merged_idx on public.wo_material_lines (merged_into) where merged_into is not null;
create index if not exists wo_material_lines_created_by_idx on public.wo_material_lines (created_by) where created_by is not null;

create table if not exists public.wo_logistics_decisions (
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  line          text not null check (line in ('paint', 'materials', 'equipment', 'rubbish')),
  decision      text not null check (decision in ('not_needed', 'painter_supplies')),
  decided_by    uuid references auth.users (id) on delete set null,
  decided_at    timestamptz not null default now(),
  is_demo       boolean not null default false,
  primary key (work_order_id, line)
);
create index if not exists wo_logistics_decisions_decided_by_idx on public.wo_logistics_decisions (decided_by) where decided_by is not null;

-- ---- 6. updated_at + demo wall --------------------------------------------------------------
drop trigger if exists t_touch on public.movements;
create trigger t_touch before update on public.movements for each row execute function public.touch_updated_at();
drop trigger if exists t_touch on public.supplier_branches;
create trigger t_touch before update on public.supplier_branches for each row execute function public.touch_updated_at();
drop trigger if exists t_touch on public.equipment_items;
create trigger t_touch before update on public.equipment_items for each row execute function public.touch_updated_at();
drop trigger if exists t_touch on public.wo_material_lines;
create trigger t_touch before update on public.wo_material_lines for each row execute function public.touch_updated_at();

drop trigger if exists t_demo_flag on public.movements;
create trigger t_demo_flag before insert on public.movements for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_material_lines;
create trigger t_demo_flag before insert on public.wo_material_lines for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_logistics_decisions;
create trigger t_demo_flag before insert on public.wo_logistics_decisions for each row execute function public.demo_flag_copy('work_order_id');

-- An item row copies the flag from its movement, not from a work order.
create or replace function public.demo_flag_copy_movement()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_flag boolean;
begin
  select is_demo into v_flag from public.movements where id = new.movement_id;
  if v_flag is not null then new.is_demo := v_flag; end if;
  return new;
end $$;
revoke all on function public.demo_flag_copy_movement() from public, authenticated, anon;
drop trigger if exists t_demo_flag on public.movement_items;
create trigger t_demo_flag before insert on public.movement_items for each row execute function public.demo_flag_copy_movement();

-- ---- 7. RLS ----------------------------------------------------------------------------------
alter table public.supplier_branches enable row level security;
alter table public.supplier_branch_accounts enable row level security;
alter table public.equipment_items enable row level security;
alter table public.movements enable row level security;
alter table public.movement_items enable row level security;
alter table public.wo_material_lines enable row level security;
alter table public.wo_logistics_decisions enable row level security;

drop policy if exists supplier_branches_staff on public.supplier_branches;
create policy supplier_branches_staff on public.supplier_branches for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists supplier_branch_accounts_staff on public.supplier_branch_accounts;
create policy supplier_branch_accounts_staff on public.supplier_branch_accounts for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists equipment_items_staff on public.equipment_items;
create policy equipment_items_staff on public.equipment_items for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists movements_staff on public.movements;
create policy movements_staff on public.movements for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists movement_items_staff on public.movement_items;
create policy movement_items_staff on public.movement_items for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists wo_material_lines_staff on public.wo_material_lines;
create policy wo_material_lines_staff on public.wo_material_lines for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists wo_logistics_decisions_staff on public.wo_logistics_decisions;
create policy wo_logistics_decisions_staff on public.wo_logistics_decisions for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Staff READ through PostgREST; every write is an RPC. A customer or painter
-- select answers [] (no policy), never an error (select is granted).
grant select on public.supplier_branches, public.supplier_branch_accounts, public.equipment_items,
  public.movements, public.movement_items, public.wo_material_lines, public.wo_logistics_decisions to authenticated;
revoke insert, update, delete on public.supplier_branches, public.supplier_branch_accounts, public.equipment_items,
  public.movements, public.movement_items, public.wo_material_lines, public.wo_logistics_decisions from authenticated, anon;
revoke all on public.supplier_branches, public.supplier_branch_accounts, public.equipment_items,
  public.movements, public.movement_items, public.wo_material_lines, public.wo_logistics_decisions from anon;
revoke all on sequence public.equipment_tag_seq from authenticated, anon;

-- ---- 8. the settings row ---------------------------------------------------------------------
-- Warehouse = the company address (⚑1) with the suburb centroid the visit map
-- already holds; boardPeople empty until Settings fills it (⚑5). Tom owns the
-- row after this: on conflict do nothing.
insert into public.settings (key, value)
select 'movements', jsonb_build_object(
  'warehouse', jsonb_build_object(
    'label', 'Warehouse',
    'address', coalesce(cp.value ->> 'addressLine1', ''),
    'suburb', coalesce(initcap(regexp_replace(coalesce(cp.value ->> 'addressLine2', ''), '\s+VIC\s+[0-9]{4}\s*$', '', 'i')), ''),
    'postcode', coalesce(substring(coalesce(cp.value ->> 'addressLine2', '') from '([0-9]{4})\s*$'), ''),
    'lat', (select vs.lat from public.visit_suburbs vs
             where lower(btrim(vs.suburb)) = lower(btrim(regexp_replace(coalesce(cp.value ->> 'addressLine2', ''), '\s+VIC\s+[0-9]{4}\s*$', '', 'i')))
             order by vs.postcode limit 1),
    'lng', (select vs.lng from public.visit_suburbs vs
             where lower(btrim(vs.suburb)) = lower(btrim(regexp_replace(coalesce(cp.value ->> 'addressLine2', ''), '\s+VIC\s+[0-9]{4}\s*$', '', 'i')))
             order by vs.postcode limit 1)),
  'nearKm', 7,
  'planningHorizonDays', 7,
  'deliveryConfirmBy', '10:00',
  'boardPeople', '[]'::jsonb,
  'showHowItWorks', true,
  'recordHireCosts', true,
  'defaultHalfTime', jsonb_build_object('AM', '07:00', 'PM', '13:00'))
from (select value from public.settings where key = 'company_profile'
      union all select '{}'::jsonb where not exists (select 1 from public.settings where key = 'company_profile')
      limit 1) cp
on conflict (key) do nothing;

-- ---- 9. helpers (no grants: they run inside the definer RPCs) -------------------------------
create or replace function public.movements_settings()
returns jsonb language sql stable set search_path = public as $$
  select coalesce((select value from public.settings where key = 'movements'), '{}'::jsonb)
$$;
revoke all on function public.movements_settings() from public, authenticated, anon;

-- Great-circle distance in km.
create or replace function public.movements_km(p_lat1 double precision, p_lng1 double precision, p_lat2 double precision, p_lng2 double precision)
returns double precision language sql immutable as $$
  select case when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
    else 2 * 6371 * asin(least(1, sqrt(
      power(sin(radians(p_lat2 - p_lat1) / 2), 2)
      + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)))) end
$$;
revoke all on function public.movements_km(double precision, double precision, double precision, double precision) from public, authenticated, anon;

-- Fewest cans for whole litres over the sizes 15, 10, 4, 2, 1 — the same answer as
-- lib/workorder/snapshot.ts cansFor (13 L = 10 + 2 + 1, 20 L = 10 + 10).
create or replace function public.movements_cans(p_litres numeric)
returns integer language plpgsql immutable as $$
declare n int := greatest(0, floor(coalesce(p_litres, 0) + 1e-9))::int; fewest int[]; i int; c int; best int;
begin
  if n = 0 then return 0; end if;
  fewest := array_fill(1000000, array[n + 1]);
  fewest[1] := 0;
  for i in 1..n loop
    best := 1000000;
    foreach c in array array[15, 10, 4, 2, 1] loop
      if c <= i and fewest[i - c + 1] + 1 < best then best := fewest[i - c + 1] + 1; end if;
    end loop;
    fewest[i + 1] := best;
  end loop;
  return fewest[n + 1];
end $$;
revoke all on function public.movements_cans(numeric) from public, authenticated, anon;

-- PG-#### when the job has a number, else its WO ref (lib/costs formats the same way).
create or replace function public.movements_job_ref(p_work_order_id uuid)
returns text language sql stable set search_path = public as $$
  select case when w.job_no is not null then 'PG-' || lpad(w.job_no::text, 4, '0') else coalesce(w.wo_ref, '') end
  from public.work_orders w where w.id = p_work_order_id
$$;
revoke all on function public.movements_job_ref(uuid) from public, authenticated, anon;

-- The job point in v1: the suburb centroid found in its address (⚑3 adds real points).
create or replace function public.movements_job_point(p_work_order_id uuid, out lat double precision, out lng double precision)
language plpgsql stable set search_path = public as $$
declare v_addr text; part text;
begin
  select coalesce(wo_snapshot ->> 'jobAddress', '') into v_addr from public.work_orders where id = p_work_order_id;
  foreach part in array string_to_array(coalesce(v_addr, ''), ',') loop
    part := btrim(regexp_replace(part, '\s+(VIC|Victoria)(\s+[0-9]{4})?\s*$', '', 'i'));
    if part = '' then continue; end if;
    select vs.lat, vs.lng into lat, lng from public.visit_suburbs vs
     where lower(btrim(vs.suburb)) = lower(part) order by vs.postcode limit 1;
    if lat is not null then return; end if;
  end loop;
end $$;
revoke all on function public.movements_job_point(uuid) from public, authenticated, anon;

-- Nearest active branch of a kind (and brand, when given): favourites first, then km.
create or replace function public.movements_nearest_branch(p_kind public.branch_kind, p_brand text, p_lat double precision, p_lng double precision, p_delivering boolean)
returns uuid language sql stable set search_path = public as $$
  select b.id from public.supplier_branches b
   where b.active and b.kind = p_kind
     and (p_brand is null or lower(b.brand) like lower(btrim(p_brand)) || '%')
     and (not p_delivering or b.delivers_to_site)
   order by b.favourite desc, public.movements_km(p_lat, p_lng, b.lat, b.lng) asc nulls last, b.branch
   limit 1
$$;
revoke all on function public.movements_nearest_branch(public.branch_kind, text, double precision, double precision, boolean) from public, authenticated, anon;

create or replace function public.movements_branch_text(p_branch_id uuid)
returns text language sql stable set search_path = public as $$
  select coalesce((select b.brand || ' ' || b.branch || case when b.address <> '' then ', ' || b.address else '' end
                   from public.supplier_branches b where b.id = p_branch_id), '')
$$;
revoke all on function public.movements_branch_text(uuid) from public, authenticated, anon;

create or replace function public.movements_site_text(p_work_order_id uuid)
returns text language sql stable set search_path = public as $$
  select coalesce((select left(coalesce(w.wo_snapshot ->> 'jobAddress', ''), 200) from public.work_orders w where w.id = p_work_order_id), '')
$$;
revoke all on function public.movements_site_text(uuid) from public, authenticated, anon;

create or replace function public.movements_event(p_work_order_id uuid, p_type text, p_meta jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_work_order_id is null then return; end if;
  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, p_type, auth.uid(),
            case when public.is_staff() then 'staff' when public.current_contractor_id() is not null then 'contractor' else 'system' end,
            coalesce(p_meta, '{}'::jsonb));
end $$;
revoke all on function public.movements_event(uuid, text, jsonb) from public, authenticated, anon;

-- Where an item is, from the latest DONE movement that carried it (brief §3.3 locations):
-- warehouse · site · stranded (site on a closed job) · person · repair · other.
create or replace function public.equipment_item_location(p_item_id uuid, out state text, out movement_id uuid, out work_order_id uuid)
language plpgsql stable set search_path = public as $$
declare m record;
begin
  select mo.id, mo.kind, mo.to_kind, mo.work_order_id as wo, w.stage
    into m
    from public.movement_items mi
    join public.movements mo on mo.id = mi.movement_id
    left join public.work_orders w on w.id = mo.work_order_id
   where mi.equipment_item_id = p_item_id and mo.status = 'done'
   order by mo.done_at desc nulls last, mo.updated_at desc
   limit 1;
  if m.id is null then state := 'warehouse'; return; end if;
  movement_id := m.id; work_order_id := m.wo;
  if m.kind = 'repair_out' then state := 'repair';
  elsif m.kind in ('equipment_return', 'repair_back') or m.to_kind = 'warehouse' then state := 'warehouse';
  elsif m.to_kind = 'person' then state := 'person';
  elsif m.to_kind = 'site' or m.kind = 'equipment_out' then
    state := case when m.stage = 'closed' then 'stranded' else 'site' end;
  else state := 'other';
  end if;
end $$;
revoke all on function public.equipment_item_location(uuid) from public, authenticated, anon;

-- Does this movement need the order step? Supplier lane, or a person picking up from a branch.
create or replace function public.movement_needs_order(p public.movements)
returns boolean language sql immutable as $$
  select p.assignee_kind = 'supplier' or (p.assignee_kind = 'person' and p.from_kind = 'branch')
$$;
revoke all on function public.movement_needs_order(public.movements) from public, authenticated, anon;

-- Booking an out creates its return in the tray (brief §3.2): equipment_out → return:<id>,
-- hire_on → hire_off:<id>, rubbish_in (skip) → hire_off:<id> as rubbish_out. Dated to the
-- job end (or the chosen return_due) as a hint; still a tray chip until it is dropped.
create or replace function public.movements_after_booked(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype; v_key text; v_kind public.movement_kind; v_due date; v_id uuid; v_title text;
        v_from public.place_kind; v_to public.place_kind; v_to_branch uuid; v_to_text text; v_from_text text;
begin
  select * into m from public.movements where id = p_id;
  if m.id is null then return; end if;
  if m.kind = 'equipment_out' then
    v_key := 'return:' || m.id; v_kind := 'equipment_return'; v_title := 'Collect ' || m.title;
    v_from := 'site'; v_to := 'warehouse'; v_to_text := 'Warehouse';
  elsif m.kind = 'hire_on' then
    v_key := 'hire_off:' || m.id; v_kind := 'hire_off'; v_title := 'Off-hire ' || m.title;
    v_from := 'site'; v_to := 'branch'; v_to_branch := m.from_branch_id; v_to_text := public.movements_branch_text(m.from_branch_id);
  elsif m.kind = 'rubbish_in' then
    v_key := 'hire_off:' || m.id; v_kind := 'rubbish_out'; v_title := 'Skip out';
    v_from := 'site'; v_to := 'branch'; v_to_branch := m.from_branch_id; v_to_text := public.movements_branch_text(m.from_branch_id);
  else
    return;
  end if;
  if exists (select 1 from public.movements where coalesce(work_order_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(m.work_order_id, '00000000-0000-0000-0000-000000000000'::uuid) and source_key = v_key) then return; end if;
  select coalesce(m.return_due, w.end_date) into v_due from public.work_orders w where w.id = m.work_order_id;
  v_due := coalesce(v_due, m.return_due);
  v_from_text := case when m.work_order_id is null then m.to_text else public.movements_site_text(m.work_order_id) end;
  insert into public.movements (work_order_id, kind, source_key, title, detail, from_kind, from_text, to_kind, to_branch_id, to_text,
                                status, due_date, order_ref, created_by)
    values (m.work_order_id, v_kind, v_key, left(v_title, 160), 'auto return for ' || m.title, v_from, v_from_text, v_to, v_to_branch, left(v_to_text, 200),
            'tray', v_due, m.order_ref, auth.uid())
    returning id into v_id;
  insert into public.movement_items (movement_id, equipment_item_id, label)
    select v_id, mi.equipment_item_id, mi.label from public.movement_items mi where mi.movement_id = m.id
    on conflict do nothing;
  perform public.movements_event(m.work_order_id, 'movement_return_created', jsonb_build_object('movement_id', v_id, 'for', m.id, 'kind', v_kind::text));
end $$;
revoke all on function public.movements_after_booked(uuid) from public, authenticated, anon;

-- ---- 10. the sync: chips come from the jobs (brief §3.2) -------------------------------------
-- Creates or refreshes TRAY chips from the Materials rows (one per product brand), the
-- material lines (one per unmerged line) and the rubbish question (one per job). Never
-- changes a placed movement except source_changed_at once it has been ordered. A tray chip
-- whose source went away is deleted. A closed job gets a tray return chip for every item
-- the register still shows on its site (stranded gear).
create or replace function public.movements_sync_for_wo(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_site text; v_lat double precision; v_lng double precision;
        r record; v_id uuid; v_key text; v_title text; v_detail text; v_branch uuid; v_status public.movement_status; v_ordered timestamptz;
        v_old_title text; v_old_detail text; v_seen uuid[] := '{}'; v_created int := 0; v_refreshed int := 0; v_removed int := 0;
        v_dec_paint text; v_dec_mat text; v_dec_rub text; v_label text; v_brand text; v_lines jsonb;
begin
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.wo_snapshot is null then return 'ok:not_issued'; end if;

  v_site := public.movements_site_text(p_work_order_id);
  select lat, lng into v_lat, v_lng from public.movements_job_point(p_work_order_id);
  select decision into v_dec_paint from public.wo_logistics_decisions where work_order_id = p_work_order_id and line = 'paint';
  select decision into v_dec_mat   from public.wo_logistics_decisions where work_order_id = p_work_order_id and line = 'materials';
  select decision into v_dec_rub   from public.wo_logistics_decisions where work_order_id = p_work_order_id and line = 'rubbish';

  if v_wo.stage <> 'closed' then
    -- Paint: one chip per product brand. Brand by product name through products.brand;
    -- a blank brand groups under Paint (brand?) (Session 0 item 6).
    if v_dec_paint is null then
      for r in
        select coalesce(nullif(btrim(p.brand), ''), '') as brand, count(*)::int as n,
               sum(coalesce((m ->> 'litres')::numeric, 0)) as litres,
               sum(public.movements_cans((m ->> 'litres')::numeric))::int as cans,
               jsonb_agg(jsonb_build_object(
                 'rowKey', coalesce(m ->> 'colourKey', m ->> 'product'), 'product', m ->> 'product',
                 'colourName', m ->> 'colourName', 'colourHex', m ->> 'colourHex', 'colourStatus', m ->> 'colourStatus',
                 'litres', (m ->> 'litres')::numeric, 'cans', public.movements_cans((m ->> 'litres')::numeric))
                 order by coalesce(m ->> 'colourKey', m ->> 'product')) as rows
          from jsonb_array_elements(coalesce(v_wo.wo_snapshot -> 'materials', '[]'::jsonb)) m
          left join lateral (select pr.brand from public.products pr
                              where lower(btrim(pr.name)) = lower(btrim(m ->> 'product'))
                              order by pr.effective_from desc nulls last limit 1) p on true
         where coalesce(m ->> 'product', '') <> ''
         group by 1
      loop
        v_brand := r.brand;
        v_key := 'paint:' || case when v_brand = '' then 'brand?' else v_brand end;
        v_label := case when v_brand = '' then 'Paint (brand?)' else v_brand end;
        v_title := left(v_label || ' · ' || r.n || case when r.n = 1 then ' line · ' else ' lines · ' end
                        || r.cans || case when r.cans = 1 then ' can' else ' cans' end, 160);
        v_detail := 'from the Materials card';
        v_branch := case when v_brand = '' then null else public.movements_nearest_branch('paint', v_brand, v_lat, v_lng, true) end;
        select id, status, ordered_at, title, detail into v_id, v_status, v_ordered, v_old_title, v_old_detail
          from public.movements where work_order_id = p_work_order_id and source_key = v_key;
        if v_id is null then
          insert into public.movements (work_order_id, kind, source_key, title, detail, from_kind, from_branch_id, from_text, to_kind, to_text, status, order_ref)
            values (p_work_order_id, 'paint', v_key, v_title, v_detail, 'branch', v_branch, public.movements_branch_text(v_branch), 'site', v_site, 'tray', public.movements_job_ref(p_work_order_id))
            returning id into v_id;
          v_created := v_created + 1;
        elsif v_status = 'tray' then
          update public.movements set title = v_title, detail = v_detail,
                 from_branch_id = coalesce(from_branch_id, v_branch),
                 from_text = case when from_branch_id is null and v_branch is not null then public.movements_branch_text(v_branch) else from_text end,
                 to_text = v_site, order_ref = case when order_ref = '' then public.movements_job_ref(p_work_order_id) else order_ref end
           where id = v_id and (title is distinct from v_title or detail is distinct from v_detail or to_text is distinct from v_site or (from_branch_id is null and v_branch is not null));
          v_refreshed := v_refreshed + 1;
        elsif v_ordered is not null and (v_old_title is distinct from v_title or (select lines from public.movements where id = v_id) is distinct from r.rows) then
          update public.movements set source_changed_at = coalesce(source_changed_at, now()) where id = v_id and lines is distinct from r.rows;
        end if;
        v_seen := v_seen || v_id;
      end loop;
    end if;

    -- Materials: one chip per line not merged into another.
    if v_dec_mat is null then
      for r in select l.id, l.text, l.source from public.wo_material_lines l
                where l.work_order_id = p_work_order_id and l.merged_into is null order by l.sort, l.created_at
      loop
        v_key := 'matline:' || r.id;
        v_title := left(r.text, 160);
        v_detail := case r.source when 'estimate' then 'from the estimate' when 'painter_request' then 'asked for by the painter' else 'from the job page' end;
        v_branch := public.movements_nearest_branch('hardware', null, v_lat, v_lng, false);
        select id, status, ordered_at, title into v_id, v_status, v_ordered, v_old_title
          from public.movements where work_order_id = p_work_order_id and source_key = v_key;
        if v_id is null then
          insert into public.movements (work_order_id, kind, source_key, title, detail, from_kind, from_branch_id, from_text, to_kind, to_text, status, order_ref)
            values (p_work_order_id, 'materials', v_key, v_title, v_detail, 'branch', v_branch, public.movements_branch_text(v_branch), 'site', v_site, 'tray', public.movements_job_ref(p_work_order_id))
            returning id into v_id;
          v_created := v_created + 1;
        elsif v_status = 'tray' then
          update public.movements set title = v_title, detail = v_detail, to_text = v_site,
                 from_branch_id = coalesce(from_branch_id, v_branch),
                 from_text = case when from_branch_id is null and v_branch is not null then public.movements_branch_text(v_branch) else from_text end
           where id = v_id and (title is distinct from v_title or detail is distinct from v_detail or to_text is distinct from v_site or (from_branch_id is null and v_branch is not null));
          v_refreshed := v_refreshed + 1;
        elsif v_ordered is not null and v_old_title is distinct from v_title then
          update public.movements set source_changed_at = coalesce(source_changed_at, now()) where id = v_id;
        end if;
        v_seen := v_seen || v_id;
      end loop;
    end if;

    -- Rubbish: one undecided chip per job until the office answers how (ruling 20).
    if v_dec_rub is null then
      v_key := 'rubbish';
      select id, status into v_id, v_status from public.movements where work_order_id = p_work_order_id and source_key = v_key;
      if v_id is null then
        insert into public.movements (work_order_id, kind, source_key, title, detail, from_kind, from_text, status, order_ref)
          values (p_work_order_id, 'rubbish_out', v_key, 'Rubbish — how?', 'undecided', 'site', v_site, 'tray', public.movements_job_ref(p_work_order_id))
          returning id into v_id;
        v_created := v_created + 1;
      end if;
      v_seen := v_seen || v_id;
    end if;

    -- A tray chip whose source went away (brand gone, line removed or merged, decision taken).
    delete from public.movements
     where work_order_id = p_work_order_id and status = 'tray'
       and (source_key like 'paint:%' or source_key like 'matline:%' or source_key = 'rubbish')
       and not (id = any (v_seen));
    get diagnostics v_removed = row_count;
    -- A placed, ordered chip whose source went away is flagged, never touched otherwise.
    update public.movements set source_changed_at = coalesce(source_changed_at, now())
     where work_order_id = p_work_order_id and status in ('planned', 'booked', 'problem') and ordered_at is not null
       and (source_key like 'paint:%' or source_key like 'matline:%')
       and not (id = any (v_seen));
  else
    -- Closed job: every item the register still shows on this site gets its return chip.
    for r in
      select mo.id as out_id, mo.title, mo.work_order_id
        from public.movements mo
       where mo.work_order_id = p_work_order_id and mo.kind = 'equipment_out' and mo.status = 'done'
         and exists (select 1 from public.movement_items mi
                      where mi.movement_id = mo.id
                        and (select state from public.equipment_item_location(mi.equipment_item_id)) = 'stranded'
                        and (select work_order_id from public.equipment_item_location(mi.equipment_item_id)) = p_work_order_id)
    loop
      if not exists (select 1 from public.movements where work_order_id = p_work_order_id and source_key = 'return:' || r.out_id) then
        perform public.movements_after_booked(r.out_id);
        v_created := v_created + 1;
      end if;
    end loop;
  end if;

  return 'ok:' || v_created || ':' || v_refreshed || ':' || v_removed;
end $$;
revoke all on function public.movements_sync_for_wo(uuid) from public, anon, authenticated;

-- A sync the office asks for by hand goes through the same function; the trigger below
-- calls it as the owner. A non-staff caller is refused by the wrapper, not the sync.
create or replace function public.movements_sync_now(p_work_order_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  return public.movements_sync_for_wo(p_work_order_id);
end $$;
revoke all on function public.movements_sync_now(uuid) from public, anon;
grant execute on function public.movements_sync_now(uuid) to authenticated;

-- The Materials-card change hook (Session 0 item 9.3): the rows live in
-- work_orders.wo_snapshot, written by wo_set_material, so the hook is on that column.
-- Also on issue (snapshot appears) and on close (stranded gear).
create or replace function public.work_orders_movements_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.wo_snapshot is not null then perform public.movements_sync_for_wo(new.id); end if;
    return new;
  end if;
  if (old.wo_snapshot -> 'materials') is distinct from (new.wo_snapshot -> 'materials')
     or (old.wo_snapshot is null and new.wo_snapshot is not null)
     or (old.stage is distinct from new.stage and new.stage = 'closed') then
    perform public.movements_sync_for_wo(new.id);
  end if;
  return new;
end $$;
revoke all on function public.work_orders_movements_sync() from public, authenticated, anon;
drop trigger if exists t_movements_sync on public.work_orders;
create trigger t_movements_sync after insert or update of wo_snapshot, stage on public.work_orders
  for each row execute function public.work_orders_movements_sync();

-- ---- 11. the staff RPCs ----------------------------------------------------------------------
-- Manual chips: anything, from + Add a chip. Gear chips check every item against the
-- register: at the warehouse → fine; stranded → the chip is created blocked_by that
-- return chip of that item; anywhere else → refused with the tag.
create or replace function public.movement_create(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_kind public.movement_kind; v_wo uuid; v_title text; v_detail text; v_id uuid; v_items uuid[]; v_item uuid;
        v_loc record; v_blocked uuid; v_tag text; v_from_kind public.place_kind; v_to_kind public.place_kind;
        v_from_branch uuid; v_to_branch uuid; v_from_text text; v_to_text text; v_cost int; v_labels text[] := '{}';
        v_return_due date;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  begin v_kind := (p ->> 'kind')::public.movement_kind; exception when others then return 'error:bad_kind'; end;
  if v_kind is null then return 'error:bad_kind'; end if;
  v_wo := nullif(p ->> 'work_order_id', '')::uuid;
  if v_wo is not null and not exists (select 1 from public.work_orders where id = v_wo) then return 'error:not_found'; end if;
  v_title := left(btrim(coalesce(p ->> 'title', '')), 160);
  v_detail := nullif(left(btrim(coalesce(p ->> 'detail', '')), 300), '');
  begin
    v_from_kind := nullif(p -> 'from' ->> 'kind', '')::public.place_kind;
    v_to_kind := nullif(p -> 'to' ->> 'kind', '')::public.place_kind;
  exception when others then return 'error:bad_place'; end;
  v_from_branch := nullif(p -> 'from' ->> 'branch_id', '')::uuid;
  v_to_branch := nullif(p -> 'to' ->> 'branch_id', '')::uuid;
  if v_from_branch is not null and not exists (select 1 from public.supplier_branches where id = v_from_branch) then return 'error:bad_branch'; end if;
  if v_to_branch is not null and not exists (select 1 from public.supplier_branches where id = v_to_branch) then return 'error:bad_branch'; end if;
  v_from_text := left(coalesce(nullif(p -> 'from' ->> 'text', ''), case when v_from_branch is not null then public.movements_branch_text(v_from_branch)
                       when v_from_kind = 'site' and v_wo is not null then public.movements_site_text(v_wo) when v_from_kind = 'warehouse' then 'Warehouse' else '' end), 200);
  v_to_text := left(coalesce(nullif(p -> 'to' ->> 'text', ''), case when v_to_branch is not null then public.movements_branch_text(v_to_branch)
                     when v_to_kind = 'site' and v_wo is not null then public.movements_site_text(v_wo) when v_to_kind = 'warehouse' then 'Warehouse' else '' end), 200);
  v_cost := nullif(p ->> 'expected_cost_cents', '')::int;
  if v_cost is not null and v_cost < 0 then return 'error:bad_cost'; end if;
  v_return_due := nullif(p ->> 'return_due', '')::date;

  -- Rubbish: one chip per job (the sync makes the question; + Add a chip may not make a second).
  if v_kind in ('rubbish_in', 'rubbish_out') and v_wo is not null
     and exists (select 1 from public.movements where work_order_id = v_wo and kind in ('rubbish_in', 'rubbish_out') and status <> 'cancelled') then
    return 'error:rubbish_exists';
  end if;

  -- Gear: items from the register, each checked.
  if p ? 'items' and jsonb_typeof(p -> 'items') = 'array' then
    select coalesce(array_agg((x)::uuid), '{}') into v_items from jsonb_array_elements_text(p -> 'items') x;
  end if;
  if v_kind in ('equipment_out', 'equipment_return', 'repair_out', 'repair_back') and coalesce(array_length(v_items, 1), 0) = 0 then
    return 'error:no_items';
  end if;
  if v_items is not null then
    foreach v_item in array v_items loop
      select e.tag || ' · ' || e.name into v_tag from public.equipment_items e where e.id = v_item and e.status <> 'retired';
      if v_tag is null then return 'error:bad_item'; end if;
      v_labels := v_labels || v_tag;
      if v_kind = 'equipment_out' then
        if exists (select 1 from public.movement_items mi join public.movements mo on mo.id = mi.movement_id
                    where mi.equipment_item_id = v_item and mo.kind = 'equipment_out' and mo.status in ('tray', 'planned', 'booked', 'problem')) then
          return 'error:item_already_planned:' || split_part(v_tag, ' · ', 1);
        end if;
        select * into v_loc from public.equipment_item_location(v_item);
        if v_loc.state = 'stranded' then
          -- The closed job owes a return chip; make sure it exists, then block on it.
          perform public.movements_sync_for_wo(v_loc.work_order_id);
          select id into v_blocked from public.movements
           where source_key = 'return:' || v_loc.movement_id and status <> 'done' limit 1;
          if v_blocked is null then return 'error:item_unavailable:' || split_part(v_tag, ' · ', 1); end if;
        elsif v_loc.state <> 'warehouse' then
          return 'error:item_unavailable:' || split_part(v_tag, ' · ', 1);
        end if;
      end if;
    end loop;
  end if;

  if v_title = '' then
    v_title := case when v_kind = 'equipment_out' then 'Gear · ' || array_to_string(v_labels, ', ')
                    when v_kind = 'equipment_return' then 'Collect ' || array_to_string(v_labels, ', ')
                    else initcap(replace(v_kind::text, '_', ' ')) end;
    v_title := left(v_title, 160);
  end if;
  if v_kind = 'equipment_out' then
    v_from_kind := coalesce(v_from_kind, 'warehouse'); v_to_kind := coalesce(v_to_kind, 'site');
    if v_from_text = '' then v_from_text := 'Warehouse'; end if;
    if v_to_text = '' and v_wo is not null then v_to_text := public.movements_site_text(v_wo); end if;
  end if;

  insert into public.movements (work_order_id, kind, title, detail, from_kind, from_branch_id, from_text, to_kind, to_branch_id, to_text,
                                status, order_ref, expected_cost_cents, blocked_by_movement_id, return_due, note, created_by)
    values (v_wo, v_kind, v_title, v_detail, v_from_kind, v_from_branch, v_from_text, v_to_kind, v_to_branch, v_to_text,
            'tray', coalesce(nullif(left(p ->> 'order_ref', 40), ''), case when v_wo is null then '' else public.movements_job_ref(v_wo) end),
            v_cost, v_blocked, v_return_due, left(coalesce(p ->> 'note', ''), 500), auth.uid())
    returning id into v_id;
  if v_items is not null then
    insert into public.movement_items (movement_id, equipment_item_id, label)
      select v_id, e.id, left(e.tag || ' · ' || e.name, 160) from public.equipment_items e where e.id = any (v_items)
      on conflict do nothing;
  end if;
  perform public.movements_event(v_wo, 'movement_created', jsonb_build_object('movement_id', v_id, 'kind', v_kind::text, 'title', v_title, 'blocked_by', v_blocked));
  return 'ok:' || v_id;
end $$;
revoke all on function public.movement_create(jsonb) from public, anon;
grant execute on function public.movement_create(jsonb) to authenticated;

-- The drop. Lane = assignee, column = day (+ half, or an exact time on an hourly lane).
-- Supplier lane refuses our own gear and a paint/materials branch that does not deliver;
-- a chip blocked by a return cannot go until that return is done; the undecided rubbish
-- question is answered in the sheet before it can land. tray → planned (an order step is
-- owed) or booked (nothing to order: a staff-style drop-off); a re-drop keeps booked.
create or replace function public.movement_place(p_id uuid, p_assignee_kind public.movement_assignee, p_assignee_id uuid, p_due_date date, p_half text default null, p_time time default null)
returns text language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype; v_table text; v_start date; v_status public.movement_status; v_seq int; v_time time;
        v_delivers boolean; v_blocked_status public.movement_status; v_probe public.movements%rowtype; v_was_booked boolean;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_due_date is null then return 'error:no_day'; end if;
  if p_half is not null and p_half not in ('AM', 'PM') then return 'error:bad_half'; end if;
  select * into m from public.movements where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if m.status in ('done', 'cancelled') then return 'error:' || m.status; end if;
  if m.source_key = 'rubbish' and m.detail = 'undecided' then return 'error:rubbish_undecided'; end if;

  if p_assignee_kind = 'supplier' then
    if p_assignee_id is not null then return 'error:bad_assignee'; end if;
    if m.kind not in ('paint', 'materials', 'hire_on', 'hire_off', 'rubbish_in', 'rubbish_out')
       or (m.kind = 'rubbish_out' and m.to_branch_id is null) then
      return 'error:supplier_own_gear';
    end if;
    if m.kind in ('paint', 'materials') then
      if m.from_branch_id is not null then
        select delivers_to_site into v_delivers from public.supplier_branches where id = m.from_branch_id;
        if not coalesce(v_delivers, false) then return 'error:branch_does_not_deliver'; end if;
      end if;
    end if;
  elsif p_assignee_kind = 'person' then
    if p_assignee_id is null then return 'error:bad_assignee'; end if;
    if exists (select 1 from public.contractors where id = p_assignee_id) then v_table := 'contractors';
    elsif exists (select 1 from public.profiles where id = p_assignee_id and role = 'staff') then v_table := 'profiles';
    else return 'error:bad_assignee'; end if;
  else
    return 'error:bad_assignee';
  end if;

  if m.blocked_by_movement_id is not null then
    select status into v_blocked_status from public.movements where id = m.blocked_by_movement_id;
    if v_blocked_status is distinct from 'done' then return 'error:blocked:' || m.blocked_by_movement_id; end if;
  end if;

  select start_date into v_start from public.work_orders where id = m.work_order_id;
  v_time := coalesce(p_time, m.time, case when p_half is not null then nullif(public.movements_settings() -> 'defaultHalfTime' ->> p_half, '')::time end);
  v_was_booked := m.status in ('booked', 'problem') or m.ordered_at is not null;

  -- Needs-order is a function of the drop: compute on the row as it will be.
  v_probe := m; v_probe.assignee_kind := p_assignee_kind; v_probe.assignee_id := p_assignee_id;
  v_status := case when v_was_booked then 'booked'::public.movement_status
                   when public.movement_needs_order(v_probe) then 'planned'::public.movement_status
                   else 'booked'::public.movement_status end;
  if m.status = 'problem' then v_status := 'problem'; end if;

  select coalesce(max(sequence), 0) + 1 into v_seq from public.movements
   where assignee_kind = p_assignee_kind and assignee_id is not distinct from p_assignee_id and due_date = p_due_date and id <> p_id;

  update public.movements
     set assignee_kind = p_assignee_kind, assignee_id = p_assignee_id, assignee_table = v_table,
         due_date = p_due_date, half = p_half, time = v_time,
         sequence = case when due_date is distinct from p_due_date or assignee_id is distinct from p_assignee_id or assignee_kind is distinct from p_assignee_kind then v_seq else coalesce(sequence, v_seq) end,
         planned_for_start = coalesce(v_start, planned_for_start),
         status = v_status,
         booked_at = case when v_status = 'booked' and booked_at is null then now() else booked_at end,
         booked_by = case when v_status = 'booked' and booked_at is null then auth.uid() else booked_by end
   where id = p_id;
  if v_status = 'booked' and not v_was_booked then perform public.movements_after_booked(p_id); end if;
  perform public.movements_event(m.work_order_id, 'movement_placed', jsonb_build_object(
    'movement_id', p_id, 'assignee_kind', p_assignee_kind::text, 'assignee_id', p_assignee_id, 'due_date', p_due_date, 'half', p_half, 'time', v_time, 'status', v_status::text));
  return 'ok:' || v_status;
end $$;
revoke all on function public.movement_place(uuid, public.movement_assignee, uuid, date, text, time) from public, anon;
grant execute on function public.movement_place(uuid, public.movement_assignee, uuid, date, text, time) to authenticated;

-- Back to the tray. Clears assignee, day, time, the order step and the booking; a done
-- movement stays done. The auto returns it created and that are still in the tray go too.
create or replace function public.movement_unplace(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into m from public.movements where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if m.status = 'done' then return 'error:done'; end if;
  update public.movements
     set assignee_kind = null, assignee_id = null, assignee_table = null, due_date = case when source_key like 'return:%' or source_key like 'hire_off:%' then due_date else null end,
         half = null, time = null, sequence = null, ordered_at = null, ordered_by = null, booked_at = null, booked_by = null,
         planned_for_start = null, painter_alerted_at = null, lines = null, status = 'tray', problem_note = '', cancelled_at = null, cancelled_by = null
   where id = p_id;
  delete from public.movements
   where coalesce(work_order_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(m.work_order_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and source_key in ('return:' || m.id, 'hire_off:' || m.id) and status = 'tray';
  perform public.movements_event(m.work_order_id, 'movement_unplaced', jsonb_build_object('movement_id', p_id, 'was', m.status::text));
  return 'ok:tray';
end $$;
revoke all on function public.movement_unplace(uuid) from public, anon;
grant execute on function public.movement_unplace(uuid) to authenticated;

-- Ordered ✓ — the office placed the order. Paint waits for the colours (colours_first);
-- the Materials rows are frozen into lines at this moment. Session 5 sends the texts; here
-- the event is logged and painter_alerted_at stays null until it does.
create or replace function public.movement_mark_ordered(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype; v_brand text; v_lines jsonb; v_was_booked boolean;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into m from public.movements where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if m.status not in ('planned', 'booked') then return 'error:' || m.status; end if;
  if not public.movement_needs_order(m) then return 'error:no_order_step'; end if;
  if m.ordered_at is not null then return 'ok:already'; end if;
  if m.kind = 'paint' and m.work_order_id is not null and not public.wo_colours_confirmed(m.work_order_id) then return 'error:colours_first'; end if;
  if m.kind = 'paint' and m.work_order_id is not null and m.source_key like 'paint:%' then
    v_brand := substr(m.source_key, 7);
    select jsonb_agg(jsonb_build_object(
             'rowKey', coalesce(x ->> 'colourKey', x ->> 'product'), 'product', x ->> 'product',
             'colourName', x ->> 'colourName', 'colourHex', x ->> 'colourHex', 'colourStatus', x ->> 'colourStatus',
             'litres', (x ->> 'litres')::numeric, 'cans', public.movements_cans((x ->> 'litres')::numeric))
             order by coalesce(x ->> 'colourKey', x ->> 'product'))
      into v_lines
      from public.work_orders w, jsonb_array_elements(coalesce(w.wo_snapshot -> 'materials', '[]'::jsonb)) x
      left join lateral (select pr.brand from public.products pr where lower(btrim(pr.name)) = lower(btrim(x ->> 'product'))
                          order by pr.effective_from desc nulls last limit 1) p on true
     where w.id = m.work_order_id
       and coalesce(nullif(btrim(p.brand), ''), 'brand?') = v_brand;
  end if;
  v_was_booked := m.status = 'booked';
  update public.movements
     set ordered_at = now(), ordered_by = auth.uid(), status = 'booked', lines = coalesce(v_lines, lines),
         booked_at = coalesce(booked_at, now()), booked_by = coalesce(booked_by, auth.uid()), source_changed_at = null
   where id = p_id;
  if not v_was_booked then perform public.movements_after_booked(p_id); end if;
  perform public.movements_event(m.work_order_id, 'movement_ordered', jsonb_build_object(
    'movement_id', p_id, 'kind', m.kind::text, 'order_ref', m.order_ref, 'client_notice', m.client_notice,
    'alert', case when m.assignee_kind = 'supplier' then 'movement_delivery_booked' else 'movement_pickup_ready' end));
  return 'ok:booked';
end $$;
revoke all on function public.movement_mark_ordered(uuid) from public, anon;
grant execute on function public.movement_mark_ordered(uuid) to authenticated;

-- booked → done · planned/booked → problem · problem → booked · anything live → cancelled.
-- equipment_out → done writes nothing else: location is derived. Auto returns are made at
-- booking (movements_after_booked), so a problem resolved back to booked makes them too.
create or replace function public.movement_set_status(p_id uuid, p_status public.movement_status, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into m from public.movements where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if p_status = 'done' then
    if m.status <> 'booked' then return 'error:not_booked'; end if;
    update public.movements set status = 'done', done_at = now(), done_by = auth.uid(), problem_note = '' where id = p_id;
  elsif p_status = 'problem' then
    if m.status not in ('planned', 'booked') then return 'error:bad_transition'; end if;
    update public.movements set status = 'problem', problem_note = left(coalesce(p_note, ''), 500) where id = p_id;
  elsif p_status = 'booked' then
    if m.status <> 'problem' then return 'error:bad_transition'; end if;
    update public.movements set status = 'booked', problem_note = '', booked_at = coalesce(booked_at, now()), booked_by = coalesce(booked_by, auth.uid()) where id = p_id;
    if m.booked_at is null then perform public.movements_after_booked(p_id); end if;
  elsif p_status = 'cancelled' then
    if m.status in ('done', 'cancelled') then return 'error:' || m.status; end if;
    update public.movements set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
           problem_note = case when coalesce(p_note, '') = '' then problem_note else left(p_note, 500) end
     where id = p_id;
    delete from public.movements
     where coalesce(work_order_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(m.work_order_id, '00000000-0000-0000-0000-000000000000'::uuid)
       and source_key in ('return:' || m.id, 'hire_off:' || m.id) and status = 'tray';
  else
    return 'error:bad_transition';
  end if;
  perform public.movements_event(m.work_order_id, 'movement_status', jsonb_build_object('movement_id', p_id, 'from', m.status::text, 'to', p_status::text, 'note', left(coalesce(p_note, ''), 500)));
  return 'ok:' || p_status;
end $$;
revoke all on function public.movement_set_status(uuid, public.movement_status, text) from public, anon;
grant execute on function public.movement_set_status(uuid, public.movement_status, text) to authenticated;

create or replace function public.movement_redate(p_id uuid, p_due_date date, p_half text default null)
returns text language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype; v_start date; v_seq int;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_due_date is null then return 'error:no_day'; end if;
  if p_half is not null and p_half not in ('AM', 'PM') then return 'error:bad_half'; end if;
  select * into m from public.movements where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if m.status in ('done', 'cancelled') then return 'error:' || m.status; end if;
  if m.status = 'tray' then
    update public.movements set due_date = p_due_date, half = p_half where id = p_id;
    return 'ok:tray';
  end if;
  select start_date into v_start from public.work_orders where id = m.work_order_id;
  select coalesce(max(sequence), 0) + 1 into v_seq from public.movements
   where assignee_kind = m.assignee_kind and assignee_id is not distinct from m.assignee_id and due_date = p_due_date and id <> p_id;
  update public.movements
     set due_date = p_due_date, half = coalesce(p_half, half),
         time = case when p_half is not null and p_half is distinct from half then nullif(public.movements_settings() -> 'defaultHalfTime' ->> p_half, '')::time else time end,
         sequence = case when due_date is distinct from p_due_date then v_seq else sequence end,
         planned_for_start = coalesce(v_start, planned_for_start)
   where id = p_id;
  perform public.movements_event(m.work_order_id, 'movement_redated', jsonb_build_object('movement_id', p_id, 'from', m.due_date, 'to', p_due_date, 'half', coalesce(p_half, m.half)));
  return 'ok:' || p_due_date;
end $$;
revoke all on function public.movement_redate(uuid, date, text) from public, anon;
grant execute on function public.movement_redate(uuid, date, text) to authenticated;

create or replace function public.movement_set_time(p_id uuid, p_time time)
returns text language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into m from public.movements where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if m.status in ('done', 'cancelled') then return 'error:' || m.status; end if;
  update public.movements set time = p_time, half = case when p_time is null then half when p_time < '12:00'::time then 'AM' else 'PM' end where id = p_id;
  return 'ok:' || coalesce(p_time::text, 'cleared');
end $$;
revoke all on function public.movement_set_time(uuid, time) from public, anon;
grant execute on function public.movement_set_time(uuid, time) to authenticated;

-- The run order within a person-day: every id must belong to that person on that day.
create or replace function public.movement_set_sequence(p_assignee_kind public.movement_assignee, p_assignee_id uuid, p_day date, p_ids uuid[])
returns text language plpgsql security definer set search_path = public as $$
declare v_n int; i int;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_day is null or p_ids is null then return 'error:bad_input'; end if;
  select count(*) into v_n from public.movements
   where id = any (p_ids) and assignee_kind = p_assignee_kind and assignee_id is not distinct from p_assignee_id and due_date = p_day and status not in ('tray', 'cancelled');
  if v_n <> coalesce(array_length(p_ids, 1), 0) then return 'error:not_that_day'; end if;
  for i in 1..coalesce(array_length(p_ids, 1), 0) loop
    update public.movements set sequence = i where id = p_ids[i];
  end loop;
  return 'ok:' || v_n;
end $$;
revoke all on function public.movement_set_sequence(public.movement_assignee, uuid, date, uuid[]) from public, anon;
grant execute on function public.movement_set_sequence(public.movement_assignee, uuid, date, uuid[]) to authenticated;

-- Branch, note, client notice, order ref, cost, text of a manual chip or a materials
-- line, and the rubbish answer (ruling 20) or the skip. Paint lines are NOT here: they go
-- through wo_set_material and the sync picks them up.
create or replace function public.movement_update(p_id uuid, p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype; v_branch uuid; v_how text; v_painter uuid; v_end date; v_skip jsonb; v_in date; v_out date;
        v_line uuid; v_text text; v_decision text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into m from public.movements where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if m.status in ('done', 'cancelled') then return 'error:' || m.status; end if;

  if p ? 'from_branch_id' then
    v_branch := nullif(p ->> 'from_branch_id', '')::uuid;
    if v_branch is not null and not exists (select 1 from public.supplier_branches where id = v_branch) then return 'error:bad_branch'; end if;
    update public.movements set from_branch_id = v_branch, from_kind = case when v_branch is null then from_kind else 'branch' end,
           from_text = case when v_branch is null then from_text else public.movements_branch_text(v_branch) end where id = p_id;
  end if;
  if p ? 'to_branch_id' then
    v_branch := nullif(p ->> 'to_branch_id', '')::uuid;
    if v_branch is not null and not exists (select 1 from public.supplier_branches where id = v_branch) then return 'error:bad_branch'; end if;
    update public.movements set to_branch_id = v_branch, to_kind = case when v_branch is null then to_kind else 'branch' end,
           to_text = case when v_branch is null then to_text else public.movements_branch_text(v_branch) end where id = p_id;
  end if;
  if p ? 'note' then update public.movements set note = left(coalesce(p ->> 'note', ''), 500) where id = p_id; end if;
  if p ? 'painter_visible' then update public.movements set painter_visible = coalesce((p ->> 'painter_visible')::boolean, false) where id = p_id; end if;
  if p ? 'client_notice' then update public.movements set client_notice = coalesce((p ->> 'client_notice')::boolean, false) where id = p_id; end if;
  if p ? 'order_ref' then update public.movements set order_ref = left(coalesce(p ->> 'order_ref', ''), 40) where id = p_id; end if;
  if p ? 'expected_cost_cents' then
    if nullif(p ->> 'expected_cost_cents', '')::int < 0 then return 'error:bad_cost'; end if;
    update public.movements set expected_cost_cents = nullif(p ->> 'expected_cost_cents', '')::int where id = p_id;
  end if;
  if p ? 'return_due' then update public.movements set return_due = nullif(p ->> 'return_due', '')::date where id = p_id; end if;
  if p ? 'time' then update public.movements set time = nullif(p ->> 'time', '')::time where id = p_id; end if;

  -- Text: a manual chip edits its own title/detail; a materials chip edits its line.
  if p ? 'title' or p ? 'detail' then
    if m.source_key like 'matline:%' then
      v_line := substr(m.source_key, 9)::uuid;
      v_text := left(btrim(coalesce(p ->> 'title', m.title)), 200);
      if v_text = '' then return 'error:empty'; end if;
      update public.wo_material_lines set text = v_text where id = v_line;
      update public.movements set title = left(v_text, 160) where id = p_id;
      if m.ordered_at is not null and v_text is distinct from m.title then update public.movements set source_changed_at = coalesce(source_changed_at, now()) where id = p_id; end if;
    elsif m.source_key is null then
      update public.movements set title = coalesce(nullif(left(btrim(p ->> 'title'), 160), ''), title),
             detail = case when p ? 'detail' then nullif(left(btrim(coalesce(p ->> 'detail', '')), 300), '') else detail end where id = p_id;
    else
      return 'error:synced_title';
    end if;
  end if;

  -- Rubbish: how (ruling 20). painter_disposed → recorded on the painter: nothing to move;
  -- painter_warehouse → a drop-off on the painter on the last day; left_on_site → a
  -- collection chip in the tray.
  if p ? 'rubbish_how' then
    if m.kind not in ('rubbish_in', 'rubbish_out') then return 'error:not_rubbish'; end if;
    v_how := p ->> 'rubbish_how';
    select coalesce(w.contractor_id, (select a.contractor_id from public.wo_assignments a where a.work_order_id = w.id and a.status <> 'released' order by a.is_lead desc, a.start_date limit 1)),
           coalesce(w.end_date, w.start_date)
      into v_painter, v_end from public.work_orders w where w.id = m.work_order_id;
    if v_how = 'none' then
      v_decision := 'not_needed';
    elsif v_how = 'painter_disposed' then
      update public.movements set title = 'Rubbish — painter disposes', detail = 'painter disposes of it', to_kind = 'tip', to_text = 'Tip' where id = p_id;
      v_decision := 'painter_supplies';
    elsif v_how = 'painter_warehouse' then
      update public.movements set title = 'Rubbish — painter drops at warehouse', detail = 'drop-off on the last day', to_kind = 'warehouse', to_text = 'Warehouse' where id = p_id;
      if v_painter is not null and v_end is not null and m.status = 'tray' then
        perform public.movement_place(p_id, 'person', v_painter, v_end, 'PM', null);
      end if;
    elsif v_how = 'left_on_site' then
      update public.movements set title = 'Rubbish — collect from site', detail = 'left on site: drop it on whoever collects, or make it a skip', to_kind = 'tip', to_text = 'Tip' where id = p_id;
    else
      return 'error:bad_rubbish_how';
    end if;
    if v_decision is not null then
      insert into public.wo_logistics_decisions (work_order_id, line, decision, decided_by)
        values (m.work_order_id, 'rubbish', v_decision, auth.uid())
        on conflict (work_order_id, line) do update set decision = excluded.decision, decided_by = excluded.decided_by, decided_at = now();
      if v_how = 'none' then
        update public.movements set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid() where id = p_id and status = 'tray';
      elsif m.status = 'tray' and v_painter is not null and v_end is not null then
        perform public.movement_place(p_id, 'person', v_painter, v_end, 'PM', null);
        update public.movements set status = 'done', done_at = now(), done_by = auth.uid() where id = p_id and status = 'booked';
      end if;
    end if;
    perform public.movements_event(m.work_order_id, 'rubbish_decided', jsonb_build_object('movement_id', p_id, 'how', v_how));
  end if;

  -- Make it a skip: {branch_id, in_date, out_date}. The chip becomes the skip in; its out
  -- is made at booking (hire_off:<id>).
  if p ? 'skip' then
    if m.kind not in ('rubbish_in', 'rubbish_out') then return 'error:not_rubbish'; end if;
    v_skip := p -> 'skip';
    v_branch := nullif(v_skip ->> 'branch_id', '')::uuid;
    v_in := nullif(v_skip ->> 'in_date', '')::date; v_out := nullif(v_skip ->> 'out_date', '')::date;
    if v_branch is null or not exists (select 1 from public.supplier_branches where id = v_branch and kind = 'hire') then return 'error:bad_branch'; end if;
    if v_in is null or v_out is null or v_out < v_in then return 'error:bad_dates'; end if;
    update public.movements
       set kind = 'rubbish_in', title = 'Skip in', detail = 'skip on site ' || to_char(v_in, 'DD Mon') || ' to ' || to_char(v_out, 'DD Mon'),
           from_kind = 'branch', from_branch_id = v_branch, from_text = public.movements_branch_text(v_branch),
           to_kind = 'site', to_text = public.movements_site_text(m.work_order_id), return_due = v_out, due_date = v_in
     where id = p_id;
    delete from public.wo_logistics_decisions where work_order_id = m.work_order_id and line = 'rubbish';
    perform public.movements_event(m.work_order_id, 'rubbish_skip', jsonb_build_object('movement_id', p_id, 'branch_id', v_branch, 'in', v_in, 'out', v_out));
  end if;

  return 'ok:' || p_id;
end $$;
revoke all on function public.movement_update(uuid, jsonb) from public, anon;
grant execute on function public.movement_update(uuid, jsonb) to authenticated;

-- Session 5 sends the text; Session 1 logs the send so the plumbing is testable.
create or replace function public.movement_send_run_plan(p_person_kind text, p_person_id uuid, p_day date)
returns text language plpgsql security definer set search_path = public as $$
declare v_n int; r record;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_person_kind not in ('profiles', 'contractors') or p_person_id is null or p_day is null then return 'error:bad_input'; end if;
  update public.movements set run_plan_sent_at = now()
   where assignee_kind = 'person' and assignee_table = p_person_kind and assignee_id = p_person_id and due_date = p_day and status in ('planned', 'booked', 'problem');
  get diagnostics v_n = row_count;
  for r in select distinct work_order_id from public.movements
            where assignee_kind = 'person' and assignee_table = p_person_kind and assignee_id = p_person_id and due_date = p_day and work_order_id is not null and status in ('planned', 'booked', 'problem')
  loop
    perform public.movements_event(r.work_order_id, 'movement_run_plan_sent', jsonb_build_object('person_kind', p_person_kind, 'person_id', p_person_id, 'day', p_day, 'stops', v_n, 'channel', 'stub'));
  end loop;
  return 'ok:' || v_n;
end $$;
revoke all on function public.movement_send_run_plan(text, uuid, date) from public, anon;
grant execute on function public.movement_send_run_plan(text, uuid, date) to authenticated;

-- The tick by the painter — Picked up / Dropped off / Returned — on a movement on their lane.
create or replace function public.movement_painter_done(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare m public.movements%rowtype; v_cid uuid;
begin
  v_cid := public.current_contractor_id();
  if v_cid is null then return 'error:not_a_contractor'; end if;
  select * into m from public.movements where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if m.assignee_kind is distinct from 'person' or m.assignee_table is distinct from 'contractors' or m.assignee_id is distinct from v_cid then return 'error:not_yours'; end if;
  if m.status = 'done' then return 'ok:already'; end if;
  if m.status <> 'booked' then return 'error:not_booked'; end if;
  update public.movements set status = 'done', done_at = now(), done_by = auth.uid(), painter_confirmed_at = now() where id = p_id;
  perform public.movements_event(m.work_order_id, 'movement_painter_done', jsonb_build_object('movement_id', p_id, 'kind', m.kind::text));
  return 'ok:done';
end $$;
revoke all on function public.movement_painter_done(uuid) from public, anon;
grant execute on function public.movement_painter_done(uuid) to authenticated;

-- ---- 12. material lines: one list, three doors ------------------------------------------------
create or replace function public.material_line_add(p_work_order_id uuid, p_text text, p_source text default 'pc')
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_text text; v_sort int;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then return 'error:not_found'; end if;
  if p_source not in ('estimate', 'pc', 'painter_request') then return 'error:bad_source'; end if;
  v_text := left(btrim(coalesce(p_text, '')), 200);
  if v_text = '' then return 'error:empty'; end if;
  select coalesce(max(sort), 0) + 1 into v_sort from public.wo_material_lines where work_order_id = p_work_order_id;
  insert into public.wo_material_lines (work_order_id, text, source, sort, created_by)
    values (p_work_order_id, v_text, p_source, v_sort, auth.uid()) returning id into v_id;
  perform public.movements_event(p_work_order_id, 'material_line_added', jsonb_build_object('line_id', v_id, 'text', v_text, 'source', p_source));
  perform public.movements_sync_for_wo(p_work_order_id);
  return 'ok:' || v_id;
end $$;
revoke all on function public.material_line_add(uuid, text, text) from public, anon;
grant execute on function public.material_line_add(uuid, text, text) to authenticated;

create or replace function public.material_line_update(p_id uuid, p_text text)
returns text language plpgsql security definer set search_path = public as $$
declare l public.wo_material_lines%rowtype; v_text text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into l from public.wo_material_lines where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  v_text := left(btrim(coalesce(p_text, '')), 200);
  if v_text = '' then return 'error:empty'; end if;
  update public.wo_material_lines set text = v_text where id = p_id;
  perform public.movements_event(l.work_order_id, 'material_line_edited', jsonb_build_object('line_id', p_id, 'from', l.text, 'to', v_text));
  perform public.movements_sync_for_wo(l.work_order_id);
  return 'ok:' || p_id;
end $$;
revoke all on function public.material_line_update(uuid, text) from public, anon;
grant execute on function public.material_line_update(uuid, text) to authenticated;

-- A line already placed on a day cannot be removed until it is back in the tray (§8 3a).
create or replace function public.material_line_remove(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare l public.wo_material_lines%rowtype; v_status public.movement_status;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into l from public.wo_material_lines where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  select status into v_status from public.movements where work_order_id = l.work_order_id and source_key = 'matline:' || p_id;
  if v_status in ('planned', 'booked', 'problem') then return 'error:placed'; end if;
  update public.wo_material_lines set merged_into = null where merged_into = p_id;
  delete from public.movements where work_order_id = l.work_order_id and source_key = 'matline:' || p_id and status in ('tray', 'cancelled', 'done');
  delete from public.wo_material_lines where id = p_id;
  perform public.movements_event(l.work_order_id, 'material_line_removed', jsonb_build_object('line_id', p_id, 'text', l.text));
  perform public.movements_sync_for_wo(l.work_order_id);
  return 'ok:removed';
end $$;
revoke all on function public.material_line_remove(uuid) from public, anon;
grant execute on function public.material_line_remove(uuid) to authenticated;

-- Merge lines into one chip: the others point at p_into; their tray chips go. Pass an
-- empty array with p_into to un-merge everything that pointed at it.
create or replace function public.material_line_merge(p_ids uuid[], p_into uuid)
returns text language plpgsql security definer set search_path = public as $$
declare l public.wo_material_lines%rowtype; v_id uuid; v_status public.movement_status;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into l from public.wo_material_lines where id = p_into for update;
  if not found then return 'error:not_found'; end if;
  if l.merged_into is not null then return 'error:target_merged'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    update public.wo_material_lines set merged_into = null where merged_into = p_into;
    perform public.movements_sync_for_wo(l.work_order_id);
    return 'ok:unmerged';
  end if;
  foreach v_id in array p_ids loop
    if v_id = p_into then continue; end if;
    if not exists (select 1 from public.wo_material_lines where id = v_id and work_order_id = l.work_order_id) then return 'error:not_same_job'; end if;
    select status into v_status from public.movements where work_order_id = l.work_order_id and source_key = 'matline:' || v_id;
    if v_status in ('planned', 'booked', 'problem') then return 'error:placed'; end if;
  end loop;
  update public.wo_material_lines set merged_into = p_into where id = any (p_ids) and id <> p_into and work_order_id = l.work_order_id;
  perform public.movements_event(l.work_order_id, 'material_lines_merged', jsonb_build_object('into', p_into, 'lines', to_jsonb(p_ids)));
  perform public.movements_sync_for_wo(l.work_order_id);
  return 'ok:' || p_into;
end $$;
revoke all on function public.material_line_merge(uuid[], uuid) from public, anon;
grant execute on function public.material_line_merge(uuid[], uuid) to authenticated;

-- Accept a painter request as a line: the request is answered ordered with the drafted
-- reply, the line is added with source painter_request, the sync makes the chip.
create or replace function public.material_request_accept(p_request_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare rq public.wo_material_requests%rowtype; v_id uuid; v_sort int; v_text text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into rq from public.wo_material_requests where id = p_request_id for update;
  if not found then return 'error:not_found'; end if;
  if rq.status <> 'requested' then return 'error:already_' || rq.status; end if;
  v_text := left(btrim(rq.item || case when coalesce(rq.quantity, '') <> '' then ' × ' || rq.quantity else '' end), 200);
  select coalesce(max(sort), 0) + 1 into v_sort from public.wo_material_lines where work_order_id = rq.work_order_id;
  insert into public.wo_material_lines (work_order_id, text, source, request_id, sort, created_by)
    values (rq.work_order_id, v_text, 'painter_request', rq.id, v_sort, auth.uid()) returning id into v_id;
  update public.wo_material_requests
     set status = 'ordered', reply = 'Added to the order — we will text you when it is ready', replied_by = auth.uid(), replied_at = now()
   where id = p_request_id;
  perform public.movements_event(rq.work_order_id, 'material_request_replied', jsonb_build_object('request_id', rq.id, 'status', 'ordered', 'item', rq.item, 'line_id', v_id));
  perform public.movements_sync_for_wo(rq.work_order_id);
  return 'ok:' || v_id;
end $$;
revoke all on function public.material_request_accept(uuid) from public, anon;
grant execute on function public.material_request_accept(uuid) to authenticated;

-- The one stored fact a job can hold without a movement. A null decision clears it.
create or replace function public.wo_logistics_decide(p_work_order_id uuid, p_line text, p_decision text default null)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not exists (select 1 from public.work_orders where id = p_work_order_id) then return 'error:not_found'; end if;
  if p_line not in ('paint', 'materials', 'equipment', 'rubbish') then return 'error:bad_line'; end if;
  if p_decision is not null and p_decision not in ('not_needed', 'painter_supplies') then return 'error:bad_decision'; end if;
  if p_decision is null then
    delete from public.wo_logistics_decisions where work_order_id = p_work_order_id and line = p_line;
  else
    insert into public.wo_logistics_decisions (work_order_id, line, decision, decided_by)
      values (p_work_order_id, p_line, p_decision, auth.uid())
      on conflict (work_order_id, line) do update set decision = excluded.decision, decided_by = excluded.decided_by, decided_at = now();
  end if;
  perform public.movements_event(p_work_order_id, 'logistics_decided', jsonb_build_object('line', p_line, 'decision', p_decision));
  perform public.movements_sync_for_wo(p_work_order_id);
  return 'ok:' || coalesce(p_decision, 'cleared');
end $$;
revoke all on function public.wo_logistics_decide(uuid, text, text) from public, anon;
grant execute on function public.wo_logistics_decide(uuid, text, text) to authenticated;

-- ---- 13. the register ------------------------------------------------------------------------
create or replace function public.equipment_item_create(p_name text, p_category public.equipment_category, p_serial_or_model text default '', p_notes text default '', p_tag text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text; v_tag text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  v_name := left(btrim(coalesce(p_name, '')), 120);
  if v_name = '' then return 'error:empty'; end if;
  v_tag := left(btrim(coalesce(p_tag, '')), 20);
  if v_tag <> '' and exists (select 1 from public.equipment_items where tag = v_tag) then return 'error:tag_taken'; end if;
  -- The seed writes tags of its own (E-001 …) without touching the sequence, so the next
  -- free tag is taken by walking the sequence past anything already in the register.
  if v_tag = '' then
    loop
      v_tag := 'E-' || lpad(nextval('public.equipment_tag_seq')::text, 3, '0');
      exit when not exists (select 1 from public.equipment_items where tag = v_tag);
    end loop;
  end if;
  insert into public.equipment_items (tag, name, category, serial_or_model, notes, created_by)
    values (v_tag, v_name, coalesce(p_category, 'other'), left(coalesce(p_serial_or_model, ''), 120), left(coalesce(p_notes, ''), 500), auth.uid())
    returning id into v_id;
  return 'ok:' || v_id;
end $$;
revoke all on function public.equipment_item_create(text, public.equipment_category, text, text, text) from public, anon;
grant execute on function public.equipment_item_create(text, public.equipment_category, text, text, text) to authenticated;

create or replace function public.equipment_item_update(p_id uuid, p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_cat public.equipment_category;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not exists (select 1 from public.equipment_items where id = p_id) then return 'error:not_found'; end if;
  if p ? 'category' then
    begin v_cat := (p ->> 'category')::public.equipment_category; exception when others then return 'error:bad_category'; end;
    update public.equipment_items set category = v_cat where id = p_id;
  end if;
  if p ? 'name' then
    if btrim(coalesce(p ->> 'name', '')) = '' then return 'error:empty'; end if;
    update public.equipment_items set name = left(btrim(p ->> 'name'), 120) where id = p_id;
  end if;
  if p ? 'serial_or_model' then update public.equipment_items set serial_or_model = left(coalesce(p ->> 'serial_or_model', ''), 120) where id = p_id; end if;
  if p ? 'notes' then update public.equipment_items set notes = left(coalesce(p ->> 'notes', ''), 500) where id = p_id; end if;
  return 'ok:' || p_id;
end $$;
revoke all on function public.equipment_item_update(uuid, jsonb) from public, anon;
grant execute on function public.equipment_item_update(uuid, jsonb) to authenticated;

create or replace function public.equipment_item_set_status(p_id uuid, p_status public.equipment_status)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if p_status is null then return 'error:bad_status'; end if;
  if p_status = 'retired' and exists (select 1 from public.movement_items mi join public.movements mo on mo.id = mi.movement_id
                                       where mi.equipment_item_id = p_id and mo.status in ('tray', 'planned', 'booked', 'problem')) then
    return 'error:in_a_movement';
  end if;
  update public.equipment_items set status = p_status where id = p_id;
  if not found then return 'error:not_found'; end if;
  return 'ok:' || p_status;
end $$;
revoke all on function public.equipment_item_set_status(uuid, public.equipment_status) from public, anon;
grant execute on function public.equipment_item_set_status(uuid, public.equipment_status) to authenticated;

-- ---- 14. suppliers ---------------------------------------------------------------------------
-- By id when given, else by (brand, branch). Makes the vendor row for the brand when missing.
create or replace function public.supplier_branch_upsert(p jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_brand text; v_branch text; v_kind public.branch_kind; v_vendor uuid; v_opens time; v_postcode text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  v_brand := left(btrim(coalesce(p ->> 'brand', '')), 80);
  v_branch := left(btrim(coalesce(p ->> 'branch', '')), 80);
  if v_brand = '' or v_branch = '' then return 'error:empty'; end if;
  begin v_kind := coalesce(nullif(p ->> 'kind', ''), 'paint')::public.branch_kind; exception when others then return 'error:bad_kind'; end;
  begin v_opens := nullif(p ->> 'opens_weekday', '')::time; exception when others then return 'error:bad_time'; end;
  v_postcode := coalesce(p ->> 'postcode', '');
  if v_postcode <> '' and v_postcode !~ '^[0-9]{4}$' then return 'error:bad_postcode'; end if;
  v_id := nullif(p ->> 'id', '')::uuid;
  if v_id is null then
    select id into v_id from public.supplier_branches where lower(btrim(brand)) = lower(v_brand) and lower(btrim(branch)) = lower(v_branch);
  end if;
  select id into v_vendor from public.vendors where lower(btrim(name)) = lower(v_brand) order by created_at limit 1;
  if v_vendor is null then
    insert into public.vendors (name, default_category) values (v_brand, (case when v_kind = 'hire' then 'equipment_hire' else 'materials' end)::public.job_cost_category) returning id into v_vendor;
  end if;
  if v_id is null then
    insert into public.supplier_branches (vendor_id, brand, branch, kind, address, suburb, postcode, phone, email, map_place_id, lat, lng, delivers_to_site, opens_weekday, favourite, active, source_url, notes)
      values (v_vendor, v_brand, v_branch, v_kind, left(coalesce(p ->> 'address', ''), 200), left(coalesce(p ->> 'suburb', ''), 80), v_postcode,
              left(coalesce(p ->> 'phone', ''), 40), left(coalesce(p ->> 'email', ''), 200), left(coalesce(p ->> 'map_place_id', ''), 200),
              nullif(p ->> 'lat', '')::double precision, nullif(p ->> 'lng', '')::double precision,
              coalesce((p ->> 'delivers_to_site')::boolean, false), v_opens, coalesce((p ->> 'favourite')::boolean, false), coalesce((p ->> 'active')::boolean, true),
              left(coalesce(p ->> 'source_url', ''), 400), left(coalesce(p ->> 'notes', ''), 500))
      returning id into v_id;
  else
    update public.supplier_branches set
      vendor_id = coalesce(vendor_id, v_vendor), brand = v_brand, branch = v_branch, kind = v_kind,
      address = case when p ? 'address' then left(coalesce(p ->> 'address', ''), 200) else address end,
      suburb = case when p ? 'suburb' then left(coalesce(p ->> 'suburb', ''), 80) else suburb end,
      postcode = case when p ? 'postcode' then v_postcode else postcode end,
      phone = case when p ? 'phone' then left(coalesce(p ->> 'phone', ''), 40) else phone end,
      email = case when p ? 'email' then left(coalesce(p ->> 'email', ''), 200) else email end,
      map_place_id = case when p ? 'map_place_id' then left(coalesce(p ->> 'map_place_id', ''), 200) else map_place_id end,
      lat = case when p ? 'lat' then nullif(p ->> 'lat', '')::double precision else lat end,
      lng = case when p ? 'lng' then nullif(p ->> 'lng', '')::double precision else lng end,
      delivers_to_site = case when p ? 'delivers_to_site' then coalesce((p ->> 'delivers_to_site')::boolean, false) else delivers_to_site end,
      opens_weekday = case when p ? 'opens_weekday' then v_opens else opens_weekday end,
      favourite = case when p ? 'favourite' then coalesce((p ->> 'favourite')::boolean, false) else favourite end,
      active = case when p ? 'active' then coalesce((p ->> 'active')::boolean, true) else active end,
      source_url = case when p ? 'source_url' then left(coalesce(p ->> 'source_url', ''), 400) else source_url end,
      notes = case when p ? 'notes' then left(coalesce(p ->> 'notes', ''), 500) else notes end
     where id = v_id;
  end if;
  return 'ok:' || v_id;
end $$;
revoke all on function public.supplier_branch_upsert(jsonb) from public, anon;
grant execute on function public.supplier_branch_upsert(jsonb) to authenticated;

-- The trade account on a branch. Staff-only table; the screen masks it; an empty ref clears it.
create or replace function public.supplier_branch_set_account(p_branch_id uuid, p_account_ref text, p_account_name text default '')
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not exists (select 1 from public.supplier_branches where id = p_branch_id) then return 'error:not_found'; end if;
  if coalesce(btrim(p_account_ref), '') = '' then
    delete from public.supplier_branch_accounts where branch_id = p_branch_id;
    return 'ok:cleared';
  end if;
  insert into public.supplier_branch_accounts (branch_id, account_ref, account_name, updated_by)
    values (p_branch_id, left(btrim(p_account_ref), 80), left(btrim(coalesce(p_account_name, '')), 120), auth.uid())
    on conflict (branch_id) do update set account_ref = excluded.account_ref, account_name = excluded.account_name, updated_by = excluded.updated_by, updated_at = now();
  return 'ok:set';
end $$;
revoke all on function public.supplier_branch_set_account(uuid, text, text) from public, anon;
grant execute on function public.supplier_branch_set_account(uuid, text, text) to authenticated;

-- ---- 15. what a painter reads (the §5 column limits) ------------------------------------------
-- Their own lane and their live jobs; no cost, no office note unless painter_visible,
-- no problem note, no address of another job.
create or replace function public.movements_for_painter(p_work_order_id uuid default null, p_day date default null)
returns table (id uuid, work_order_id uuid, kind public.movement_kind, source_key text, title text, detail text, status public.movement_status,
               due_date date, half text, "time" time, sequence integer, from_kind public.place_kind, from_text text, to_kind public.place_kind, to_text text,
               order_ref text, note text, lines jsonb, ordered_at timestamptz, painter_confirmed_at timestamptz, mine boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.work_order_id, m.kind, m.source_key, m.title, m.detail, m.status, m.due_date, m.half, m.time, m.sequence,
         m.from_kind, m.from_text, m.to_kind, m.to_text, m.order_ref,
         case when m.painter_visible then m.note else '' end as note,
         m.lines, m.ordered_at, m.painter_confirmed_at,
         (m.assignee_kind = 'person' and m.assignee_table = 'contractors' and m.assignee_id = public.current_contractor_id()) as mine
    from public.movements m
   where public.current_contractor_id() is not null
     and m.status not in ('cancelled')
     and ((m.assignee_kind = 'person' and m.assignee_table = 'contractors' and m.assignee_id = public.current_contractor_id())
          or (m.work_order_id is not null and public.wo_is_my_job_as_contractor(m.work_order_id)))
     and (p_work_order_id is null or m.work_order_id = p_work_order_id)
     and (p_day is null or m.due_date = p_day)
   order by m.due_date nulls last, m.sequence nulls last, m.time nulls last, m.created_at
$$;
revoke all on function public.movements_for_painter(uuid, date) from public, anon;
grant execute on function public.movements_for_painter(uuid, date) to authenticated;

create or replace function public.supplier_branches_for_painter()
returns table (id uuid, brand text, branch text, address text, suburb text, phone text, opens_weekday time, map_place_id text)
language sql stable security definer set search_path = public as $$
  select b.id, b.brand, b.branch, b.address, b.suburb, b.phone, b.opens_weekday, b.map_place_id
    from public.supplier_branches b
   where b.active and public.current_contractor_id() is not null
   order by b.brand, b.branch
$$;
revoke all on function public.supplier_branches_for_painter() from public, anon;
grant execute on function public.supplier_branches_for_painter() to authenticated;

-- ---- read-back: compare every column to its _expect_ before calling this live --------------
select
  (select count(*) from pg_type where typname in ('movement_kind', 'movement_status', 'movement_assignee', 'place_kind', 'branch_kind', 'equipment_category', 'equipment_status')) as enums, 7 as _expect_enums,
  (select count(*) from information_schema.tables where table_schema = 'public' and table_name in
     ('movements', 'movement_items', 'wo_material_lines', 'equipment_items', 'supplier_branches', 'supplier_branch_accounts', 'wo_logistics_decisions')) as tables_made, 7 as _expect_tables_made,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relrowsecurity and c.relname in
     ('movements', 'movement_items', 'wo_material_lines', 'equipment_items', 'supplier_branches', 'supplier_branch_accounts', 'wo_logistics_decisions')) as rls_on, 7 as _expect_rls_on,
  (select count(*) from pg_policies where schemaname = 'public' and tablename in
     ('movements', 'movement_items', 'wo_material_lines', 'equipment_items', 'supplier_branches', 'supplier_branch_accounts', 'wo_logistics_decisions')) as policies, 7 as _expect_policies,
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid where t.tgname = 't_demo_flag' and c.relname in ('movements', 'movement_items', 'wo_material_lines', 'wo_logistics_decisions')) as demo_triggers, 4 as _expect_demo_triggers,
  (select count(*) from pg_trigger where tgname = 't_movements_sync' and tgrelid = 'public.work_orders'::regclass) as sync_trigger, 1 as _expect_sync_trigger,
  (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('movements_wo_idx', 'movements_day_idx', 'movements_assignee_idx', 'movements_tray_idx', 'movements_source_key_key')) as movement_indexes, 5 as _expect_movement_indexes,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in
     ('movements_sync_for_wo', 'movements_sync_now', 'movement_create', 'movement_place', 'movement_unplace', 'movement_mark_ordered', 'movement_set_status',
      'movement_redate', 'movement_set_time', 'movement_set_sequence', 'movement_update', 'movement_send_run_plan', 'movement_painter_done',
      'material_line_add', 'material_line_update', 'material_line_remove', 'material_line_merge', 'material_request_accept', 'wo_logistics_decide',
      'equipment_item_create', 'equipment_item_update', 'equipment_item_set_status', 'supplier_branch_upsert', 'supplier_branch_set_account',
      'movements_for_painter', 'supplier_branches_for_painter')) as rpcs, 26 as _expect_rpcs,
  has_function_privilege('authenticated', 'public.movement_place(uuid, public.movement_assignee, uuid, date, text, time)', 'execute') as auth_can_place, true as _expect_auth_can_place,
  has_function_privilege('anon', 'public.movement_place(uuid, public.movement_assignee, uuid, date, text, time)', 'execute') as anon_can_place, false as _expect_anon_can_place,
  has_function_privilege('authenticated', 'public.movements_after_booked(uuid)', 'execute') as auth_can_call_helper, false as _expect_auth_can_call_helper,
  has_table_privilege('authenticated', 'public.movements', 'select') as auth_can_read_movements, true as _expect_auth_can_read_movements,
  has_table_privilege('authenticated', 'public.movements', 'update') as auth_can_update_movements, false as _expect_auth_can_update_movements,
  has_table_privilege('anon', 'public.supplier_branch_accounts', 'select') as anon_can_read_accounts, false as _expect_anon_can_read_accounts,
  (select value -> 'warehouse' ->> 'suburb' from public.settings where key = 'movements') as warehouse_suburb, 'Oakleigh South' as _expect_warehouse_suburb,
  (select (value ->> 'nearKm')::int from public.settings where key = 'movements') as near_km, 7 as _expect_near_km,
  (select jsonb_array_length(value -> 'boardPeople') from public.settings where key = 'movements') as board_people, 0 as _expect_board_people,
  public.movements_cans(13) as cans_13, 3 as _expect_cans_13,
  public.movements_cans(20) as cans_20, 2 as _expect_cans_20;

insert into public._prod_migrations(name) values ('20270279000000_movements.sql') on conflict (name) do nothing;
