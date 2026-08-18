-- The R2 boundary migration (20260903) granted estimates UPDATE column-by-
-- column, enumerating the columns that existed then. storey_heights arrived
-- later (20260913), so staff writes to it are silently refused until granted.
-- Found by the Step 4 capture e2e: the room saved, the heights did not.

grant update (storey_heights) on public.estimates to authenticated;

-- ---- Verification ------------------------------------------------------------
-- Capture a room at /quote/capture, then:
--   select storey_heights from estimates order by created_at desc limit 1;
-- Expect e.g. {"ground": 2.4} rather than null.
