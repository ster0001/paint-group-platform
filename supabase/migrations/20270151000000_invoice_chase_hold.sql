-- Session 3 of the messaging-automations brief (Tom, 16 Sep 2026):
-- a dispute hold on an invoice pauses the unpaid-invoice reminders.
-- `chase_hold_reason` null = reminders run; any text = paused, and the text
-- is why (shown on the invoice row). Set and cleared by staff from Invoicing.
alter table public.invoices add column if not exists chase_hold_reason text;
comment on column public.invoices.chase_hold_reason is
  'Session 3 (16 Sep 2026): non-null pauses the unpaid-invoice reminder ladder; the text is the reason (a dispute, a payment plan).';

select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'invoices' and column_name = 'chase_hold_reason';

insert into public._prod_migrations(name) values ('20270151000000_invoice_chase_hold.sql') on conflict (name) do nothing;
