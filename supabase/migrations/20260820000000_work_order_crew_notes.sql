-- Work-order-level "further instructions" note (shown at the top for the crew).
alter table public.work_orders add column if not exists crew_notes text not null default '';
