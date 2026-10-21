-- =============================================================================
-- Movements: apply the no-default-shop ruling (Tom, 21 Oct 2026) to the chips that already
-- existed. 20270287 stopped NEW materials lines getting a shop; the materials chips made
-- before it still carried the nearest hardware store (Bunnings) the old sync chose. Those
-- never went through the confirm step, so they are reset to no shop: the office confirms
-- the shop and delivery or pickup in the chip, as for every new one.
--
-- Only chips nobody has touched are reset: still in the tray, never ordered, no method
-- confirmed. A chip someone placed on a lane, ordered, or confirmed keeps its shop.
-- Converging: the second run finds nothing to reset.
-- =============================================================================
set lock_timeout = '15s';

update public.movements
   set from_kind = null, from_branch_id = null, from_text = ''
 where kind = 'materials'
   and status = 'tray'
   and ordered_at is null
   and method_pref is null
   and from_branch_id is not null;

-- ---- read-back: compare to the _expect_ values before calling this live ------------------
select
  (select count(*) from public.movements where kind = 'materials' and status = 'tray' and ordered_at is null and method_pref is null and from_branch_id is not null) as tray_materials_with_default_shop, 0 as _expect_tray_materials_with_default_shop,
  (select count(*) from public.movements where kind = 'materials' and status = 'tray' and from_branch_id is null) as tray_materials_awaiting_confirm;

insert into public._prod_migrations(name) values ('20270288000000_movements_clear_default_shop.sql') on conflict (name) do nothing;
