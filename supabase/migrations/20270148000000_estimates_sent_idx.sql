-- Tom, 15 Sep 2026: sent quotes gone quiet are now work items (followup_due,
-- lib/crm/work-queue.ts buildQuietQuoteItems). The queue reads
--   estimates where status = 'sent' and sent_at >= now() - 90 days
-- on every Today / badge build; `status` had no index at all. A partial
-- index on the sent rows, ordered by when they went out, is the read.
create index if not exists estimates_sent_at_idx
  on public.estimates (sent_at desc)
  where status = 'sent';

do $$
begin
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'estimates_sent_at_idx') then
    raise exception 'read-back: estimates_sent_at_idx missing';
  end if;
end $$;

select indexname from pg_indexes where indexname = 'estimates_sent_at_idx';

insert into public._prod_migrations(name) values ('20270148000000_estimates_sent_idx.sql') on conflict (name) do nothing;
