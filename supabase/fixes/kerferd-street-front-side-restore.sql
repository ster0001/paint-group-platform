-- 73 Kerferd Street (PS-3613, estimate #1555), 8 Oct 2026 — put the Front
-- Side back into the revision working scope.
--
-- In Revise scope on 8 Oct (05:30–05:45Z) the Front Side area (block id 3)
-- was switched from an Interior room to an Exterior surface area. That
-- change wiped the code of its four imported surfaces (Soffits / Eaves,
-- Fascias, Fretwork, Posts — "Custom surface (imported)", which the picker
-- cannot put back), so the area priced to nothing and the builder shows it
-- as a credit variation awaiting approval. Nothing was drafted or signed:
-- there is no wo_variations row, the painter's job sheet (wo_snapshot) and
-- tick list still carry all four surfaces, and the accepted scope is intact.
--
-- This copies block 3 from accepted_state back over the working copy and
-- restores the four rows on the working sheet (woDoc.areas, area id 3) so
-- the diff against the accepted scope is empty for the Front Side again.
-- Every other working-scope edit on the job (start date 12 Oct, SWMS,
-- Haymes Trim Plus on the trims, admin notes) is left as it is.
--
-- Converges on a re-run: the update is guarded by the broken state it
-- expects and does nothing once the block matches the accepted scope.
-- After pasting, open Revise scope on the estimate and confirm the Front
-- Side no longer shows a pending change.
set lock_timeout = '15s';

update public.wo_working_scopes s
   set working_state = jsonb_set(
         jsonb_set(s.working_state, '{blocks}', (
           select jsonb_agg(
                    case when b ->> 'id' = '3'
                         then (select ab from jsonb_array_elements(s.accepted_state -> 'blocks') ab where ab ->> 'id' = '3' limit 1)
                         else b end
                    order by i)
             from jsonb_array_elements(s.working_state -> 'blocks') with ordinality t(b, i)), false),
         '{woDoc,areas}', (
           select jsonb_agg(
                    case when a ->> 'id' = '3' and jsonb_array_length(coalesce(a -> 'surfaces', '[]'::jsonb)) = 0
                         then a || jsonb_build_object('surfaces',
                                (select aa -> 'surfaces' from jsonb_array_elements(s.accepted_state -> 'woDoc' -> 'areas') aa where aa ->> 'id' = '3' limit 1))
                         else a end
                    order by i)
             from jsonb_array_elements(s.working_state -> 'woDoc' -> 'areas') with ordinality t(a, i)), false),
       updated_at = now()
 where s.estimate_id = '3a5f747d-f4e6-49b9-ab47-09932e98cbb4'
   and exists (select 1 from jsonb_array_elements(s.working_state -> 'blocks') b
                where b ->> 'id' = '3' and b ->> 'name' = 'Front Side'
                  and b ->> 'type' = 'Exterior' and b ->> 'areaType' = 'surface'
                  and (select count(*) from jsonb_array_elements(b -> 'surfaces') x where coalesce(x ->> 'code', '') = '') = 4)
   and exists (select 1 from jsonb_array_elements(s.accepted_state -> 'blocks') ab
                where ab ->> 'id' = '3' and ab ->> 'type' = 'Interior' and ab ->> 'areaType' = 'room'
                  and jsonb_array_length(ab -> 'surfaces') = 4);

-- read-back: every value must equal its _expect_ twin
select (select b ->> 'type' from jsonb_array_elements(working_state -> 'blocks') b where b ->> 'id' = '3') as front_type, 'Interior' as _expect_type,
       (select b ->> 'areaType' from jsonb_array_elements(working_state -> 'blocks') b where b ->> 'id' = '3') as front_area_type, 'room' as _expect_area_type,
       (select string_agg(x ->> 'clientLabel', ', ' order by (x ->> 'id')::int) from jsonb_array_elements(working_state -> 'blocks') b, jsonb_array_elements(b -> 'surfaces') x
         where b ->> 'id' = '3' and x ->> 'code' = 'Custom surface (imported)') as front_surfaces, 'Soffits / Eaves, Fascias, Fretwork, Posts' as _expect_surfaces,
       (select jsonb_array_length(a -> 'surfaces') from jsonb_array_elements(working_state -> 'woDoc' -> 'areas') a where a ->> 'id' = '3') as front_sheet_rows, 4 as _expect_sheet_rows,
       (select b = (select ab from jsonb_array_elements(accepted_state -> 'blocks') ab where ab ->> 'id' = '3') from jsonb_array_elements(working_state -> 'blocks') b where b ->> 'id' = '3') as front_matches_accepted, true as _expect_matches
  from public.wo_working_scopes
 where estimate_id = '3a5f747d-f4e6-49b9-ab47-09932e98cbb4';
