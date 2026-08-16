-- =============================================================================
-- Work Orders v1 — generation + contractor link
-- A work order is created automatically when an estimate is accepted. It holds
-- only work-order-specific fields; scope is derived from the estimate. The
-- contractor-safe document is frozen into wo_snapshot when staff issue it, and
-- served to the public /w/[token] route via a security-definer RPC (no customer
-- pricing/margin, no customer surname/email).
-- =============================================================================

do $$ begin
  create type public.wo_status as enum ('draft', 'issued', 'in_progress', 'complete');
exception when duplicate_object then null; end $$;

-- Per-surface status — used read-only in v1, interactive in v2.
do $$ begin
  create type public.wo_surface_status as enum ('not_started', 'in_progress', 'complete');
exception when duplicate_object then null; end $$;

create table if not exists public.work_orders (
  id                       uuid primary key default gen_random_uuid(),
  estimate_id              uuid not null unique references public.estimates (id) on delete cascade,
  wo_ref                   text not null,
  status                   public.wo_status not null default 'draft',
  contractor_id            uuid references public.contractors (id) on delete set null,
  start_date               date,
  access_notes             text not null default '',
  share_token              text not null unique,
  contractor_payment_cents integer,
  -- staff-editable structured fields (keyed by product / surface)
  colours                  jsonb not null default '{}',   -- { productName: { status, name } }
  hours_overrides          jsonb not null default '{}',   -- { surfaceKey: hours }
  surface_status           jsonb not null default '{}',   -- { surfaceKey: wo_surface_status } (v2)
  wo_snapshot              jsonb,                          -- contractor-safe document, set on issue
  viewed_at                timestamptz,
  issued_at                timestamptz,
  created_at               timestamptz not null default now()
);
create index if not exists work_orders_estimate_idx on public.work_orders (estimate_id);

-- v2 will make per-surface status interactive; the table + enum exist now.
create table if not exists public.work_order_surfaces (
  id             uuid primary key default gen_random_uuid(),
  work_order_id  uuid not null references public.work_orders (id) on delete cascade,
  surface_key    text not null,
  status         public.wo_surface_status not null default 'not_started',
  created_at     timestamptz not null default now(),
  unique (work_order_id, surface_key)
);

alter table public.work_orders          enable row level security;
alter table public.work_order_surfaces  enable row level security;

drop policy if exists work_orders_staff on public.work_orders;
create policy work_orders_staff on public.work_orders
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists work_order_surfaces_staff on public.work_order_surfaces;
create policy work_order_surfaces_staff on public.work_order_surfaces
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---- Accept: also create a draft work order (idempotent) --------------------
create or replace function public.accept_estimate(p_token text, p_name text, p_options jsonb, p_total_cents integer, p_deposit_cents integer)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status public.estimate_status; v_share text;
begin
  select id, status, share_token into v_id, v_status, v_share from public.estimates where share_token = p_token;
  if v_id is null then return 'not_found'; end if;
  if v_status = 'accepted' then return 'already'; end if;
  update public.estimates
    set status = 'accepted', accepted_at = now(), accepted_name = p_name,
        selected_options = p_options, total_cents = coalesce(p_total_cents, total_cents)
    where id = v_id;
  insert into public.estimate_events (estimate_id, type, payload)
    values (v_id, 'accepted', jsonb_build_object('name', p_name, 'options', p_options, 'total_cents', p_total_cents));
  insert into public.invoices (estimate_id, status, amount_cents, issued_on)
    values (v_id, 'draft', coalesce(p_deposit_cents, 0), current_date);
  -- Work order stub: WO ref mirrors the EST ref; its own share token is random.
  insert into public.work_orders (estimate_id, wo_ref, share_token)
    values (v_id, 'WO-' || upper(substr(coalesce(v_share, replace(gen_random_uuid()::text,'-','')), 1, 8)),
            replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
    on conflict (estimate_id) do nothing;
  return 'accepted';
end; $$;

grant execute on function public.accept_estimate(text, text, jsonb, integer, integer) to anon, authenticated;

-- ---- Public contractor link: token-only, issued work orders only -----------
create or replace function public.get_work_order_by_token(p_token text)
returns table (wo_ref text, status public.wo_status, snapshot jsonb, start_date date,
               issued_at timestamptz, viewed_at timestamptz)
language sql security definer set search_path = public as $$
  select w.wo_ref, w.status, w.wo_snapshot, w.start_date, w.issued_at, w.viewed_at
  from public.work_orders w
  where w.share_token = p_token and w.issued_at is not null
  limit 1;
$$;
grant execute on function public.get_work_order_by_token(text) to anon, authenticated;

create or replace function public.record_work_order_view(p_token text)
returns void language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.work_orders where share_token = p_token and issued_at is not null;
  if v_id is null then return; end if;
  update public.work_orders set viewed_at = now() where id = v_id and viewed_at is null;
end; $$;
grant execute on function public.record_work_order_view(text) to anon, authenticated;
