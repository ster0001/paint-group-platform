-- =============================================================================
-- Estimate numbers (Tom, 29 Sep 2026: "change all estimate and invoice numbers
-- to 4 digit numbers instead of a mix of letters and numbers" + "add the
-- estimate number in the estimate view page to the left of the address").
--
-- Estimates never had a number: the customer saw the first 8 characters of the
-- share token (EST-K3M9XQ1A) and staff saw the first 8 of the UUID — two
-- different strings for one estimate, neither of them a number. This adds
-- `estimates.number`, a plain integer from one sequence, set by trigger on
-- insert so every path that creates an estimate (builder save, wizard,
-- duplicate, import) gets one without knowing. Displayed zero-padded to four
-- digits (0042) by lib/estimate/number.ts; the padding is display only, the
-- fifth digit simply appears when it is needed.
--
-- Existing estimates are numbered in the order they were created, so the
-- oldest is 0001 and today's sit at the top of the range. Invoices already
-- carry a 4-digit sequence behind a prefix (INV-0153, Settings → Invoicing
-- → numbering); nothing here touches them.
--
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

create sequence if not exists public.estimate_no_seq;

alter table public.estimates add column if not exists number integer;
create unique index if not exists estimates_number_key on public.estimates (number);

-- Backfill in creation order, only rows without a number (idempotent).
do $$
declare v_max integer;
begin
  with ordered as (
    select id, row_number() over (order by created_at, id) as rn
      from public.estimates where number is null
  )
  update public.estimates e
     set number = coalesce((select max(number) from public.estimates), 0) + o.rn
    from ordered o where o.id = e.id;
  select coalesce(max(number), 0) into v_max from public.estimates;
  perform setval('public.estimate_no_seq', greatest(v_max, 1), v_max > 0);
end $$;

-- Every new estimate takes the next number on insert, whatever created it.
create or replace function public.estimates_assign_number()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.number is null then new.number := nextval('public.estimate_no_seq'); end if;
  return new;
end $$;
-- Trigger function: no grant (it runs as the owner).

drop trigger if exists t_estimates_assign_number on public.estimates;
create trigger t_estimates_assign_number before insert on public.estimates
  for each row execute function public.estimates_assign_number();

-- The estimates_frozen guard (accepted rows are byte-frozen) never sees an
-- insert, and the number is never updated after, so nothing else changes.

-- The customer's page reads the number off the row, not the snapshot, so
-- every estimate already sent shows it without a re-save. A return-table
-- change needs drop + create; the grants are re-stated (token page, no
-- session → anon as well, exactly as before).
drop function if exists public.get_estimate_by_token(text);
create function public.get_estimate_by_token(p_token text)
returns table (
  id uuid, status public.estimate_status, snapshot jsonb, accepted_name text,
  accepted_at timestamptz, declined_reason text, valid_until date,
  sent_at timestamptz, viewed_at timestamptz, selected_options jsonb, number integer
)
language sql security definer set search_path = public as $$
  select e.id, e.status, e.sent_snapshot, e.accepted_name, e.accepted_at,
         e.declined_reason, e.valid_until, e.sent_at, e.viewed_at, e.selected_options, e.number
  from public.estimates e
  where e.share_token = p_token and e.sent_at is not null
  limit 1;
$$;
grant execute on function public.get_estimate_by_token(text) to anon, authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select count(*) from public.estimates where number is null) as unnumbered, 0 as _expect_unnumbered,
  (select count(*) from pg_trigger where tgname = 't_estimates_assign_number' and not tgisinternal) as trigger_ok, 1 as _expect_trigger_ok,
  (select count(*) from pg_indexes where indexname = 'estimates_number_key') as unique_ok, 1 as _expect_unique_ok,
  (select last_value >= coalesce((select max(number) from public.estimates), 0) from public.estimate_no_seq) as seq_ok, true as _expect_seq_ok,
  (select has_function_privilege('anon', 'public.get_estimate_by_token(text)', 'execute')) as token_page_ok, true as _expect_token_page_ok,
  (select pg_get_function_result('public.get_estimate_by_token(text)'::regprocedure) like '%number integer%') as returns_number, true as _expect_returns_number;

insert into public._prod_migrations(name) values ('20270204000000_estimate_numbers.sql') on conflict (name) do nothing;
