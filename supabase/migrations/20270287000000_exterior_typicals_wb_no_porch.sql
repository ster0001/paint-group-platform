-- Exterior wizard v2 (Tom, 21 Oct 2026, item 2): a weatherboard home starts WITHOUT a porch and posts.
-- They are drawn and priced only when the customer ticks the verandah. The built-in list
-- (lib/wizard/exterior-typicals.ts) says the same; this brings the table row into line.
-- Converges on a re-run. Only the proposed row changes -- a row Tom has made his own (source = tom) is left alone.
set lock_timeout = '15s';

update public.exterior_typicals
   set verandah = 'none'
 where key = 'wb' and version = 1 and source = 'proposed' and verandah <> 'none';

select
  (select verandah from public.exterior_typicals where key = 'wb' and version = 1) as wb_verandah, 'none' as _expect_wb_verandah,
  (select count(*) from public.exterior_typicals where version = 1) as rows_v1, 9 as _expect_rows_v1;

insert into public._prod_migrations(name) values ('20270287000000_exterior_typicals_wb_no_porch.sql') on conflict (name) do nothing;
