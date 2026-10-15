-- 20270275 · 12 Demo Street: photos, measurements and counts, pre-start ticked
--
-- Tom, 15 Oct 2026, after walking the practice job on his phone:
--   1. No photos on the demo job.          -> five office (reference) photos, one per room,
--                                              shared files at demo/reference/<room>.jpg in the
--                                              wo-photos bucket (uploaded once by
--                                              scripts/seed-demo-photos.ts), one wo_photos row
--                                              per room per seed. A new storage policy lets any
--                                              signed-in painter sign a demo/ path; the rows are
--                                              scoped to the job by wo_photo_access as always.
--   2. The pre-start list blocked Start.    -> the seed ticks every pre-start item and writes the
--                                              three colours as confirmed, so the painter starts
--                                              the practice job the way the slides say. The gate
--                                              itself is untouched (demo-robots proves the
--                                              before-photo gate still holds).
--   3. No room measurements or door and     -> every area carries dims {l, w, h} and every
--      frame counts.                            per-item surface (Doors, Window frames) a count,
--                                              in the same snapshot shape 20270272 freezes on a
--                                              real job. The Hallway label Doors x 3 becomes
--                                              Doors with count 3.
--   The fifth photo is a kitchen, so the house gains a Kitchen (five rooms, 27 surfaces); the
--   hours are rebalanced so the job is still 40 hours over 5 days.
--   (4. the start-date request is auto-approved by the robot office: lib/demo/robots.ts, no SQL.)
--
-- Converges on a re-run. No quotes in comments.

set lock_timeout = '15s';

-- ---- 1. the template: dims, counts, a kitchen ------------------------------------------
create or replace function public.demo_property_template()
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'title', '12 Demo Street, Demoville',
    'address', '12 Demo Street, Demoville VIC 3000',
    'contractCents', 890000,
    'paymentCents', 260000,
    'hours', 40,
    'days', 5,
    'materials', jsonb_build_array(
      jsonb_build_object('product', 'Dulux Wash&Wear Low Sheen', 'finish', 'Low sheen', 'photoUrl', '', 'litres', 20, 'estimatedLitres', 18.4, 'coverageMissing', false, 'colourName', 'Natural White', 'colourHex', '#F4F2EC', 'colourStatus', 'confirmed'),
      jsonb_build_object('product', 'Dulux Ceiling White', 'finish', 'Flat', 'photoUrl', '', 'litres', 10, 'estimatedLitres', 9.1, 'coverageMissing', false, 'colourName', 'Ceiling White', 'colourHex', '#FAFAF7', 'colourStatus', 'confirmed'),
      jsonb_build_object('product', 'Dulux Aquanamel Semi Gloss', 'finish', 'Semi gloss', 'photoUrl', '', 'litres', 4, 'estimatedLitres', 3.6, 'coverageMissing', false, 'colourName', 'Vivid White', 'colourHex', '#FFFFFF', 'colourStatus', 'confirmed')
    ),
    'areas', jsonb_build_array(
      jsonb_build_object('title', 'Bedroom 1', 'meta', '3.6 × 3.2 m · 2.7 m ceiling', 'photo', 'bedroom-1.jpg',
        'dims', jsonb_build_object('l', 3.6, 'w', 3.2, 'h', 2.7), 'surfaces', jsonb_build_array(
        jsonb_build_object('label', 'Walls', 'hours', 4, 'product', 'Dulux Wash&Wear Low Sheen'),
        jsonb_build_object('label', 'Ceilings', 'hours', 2, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Cornices', 'hours', 1, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Skirting boards', 'hours', 1.5, 'product', 'Dulux Aquanamel Semi Gloss'),
        jsonb_build_object('label', 'Window frames', 'hours', 1.5, 'product', 'Dulux Aquanamel Semi Gloss', 'count', 1),
        jsonb_build_object('label', 'Doors', 'hours', 1, 'product', 'Dulux Aquanamel Semi Gloss', 'count', 1))),
      jsonb_build_object('title', 'Bedroom 2', 'meta', '3.2 × 3.0 m · 2.7 m ceiling', 'photo', 'bedroom-2.jpg',
        'dims', jsonb_build_object('l', 3.2, 'w', 3.0, 'h', 2.7), 'surfaces', jsonb_build_array(
        jsonb_build_object('label', 'Walls', 'hours', 3.5, 'product', 'Dulux Wash&Wear Low Sheen'),
        jsonb_build_object('label', 'Ceilings', 'hours', 2, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Cornices', 'hours', 1, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Skirting boards', 'hours', 1.5, 'product', 'Dulux Aquanamel Semi Gloss'),
        jsonb_build_object('label', 'Window frames', 'hours', 1.5, 'product', 'Dulux Aquanamel Semi Gloss', 'count', 1),
        jsonb_build_object('label', 'Doors', 'hours', 1, 'product', 'Dulux Aquanamel Semi Gloss', 'count', 1))),
      jsonb_build_object('title', 'Lounge', 'meta', '5.0 × 4.2 m · 2.7 m ceiling', 'photo', 'lounge.jpg',
        'dims', jsonb_build_object('l', 5.0, 'w', 4.2, 'h', 2.7), 'surfaces', jsonb_build_array(
        jsonb_build_object('label', 'Walls', 'hours', 4, 'product', 'Dulux Wash&Wear Low Sheen'),
        jsonb_build_object('label', 'Ceilings', 'hours', 2, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Cornices', 'hours', 1, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Skirting boards', 'hours', 1.5, 'product', 'Dulux Aquanamel Semi Gloss'),
        jsonb_build_object('label', 'Architraves', 'hours', 1, 'product', 'Dulux Aquanamel Semi Gloss'),
        jsonb_build_object('label', 'Window frames', 'hours', 1, 'product', 'Dulux Aquanamel Semi Gloss', 'count', 2))),
      jsonb_build_object('title', 'Kitchen', 'meta', '3.8 × 3.0 m · 2.7 m ceiling', 'photo', 'kitchen.jpg',
        'dims', jsonb_build_object('l', 3.8, 'w', 3.0, 'h', 2.7), 'surfaces', jsonb_build_array(
        jsonb_build_object('label', 'Walls', 'hours', 2, 'product', 'Dulux Wash&Wear Low Sheen'),
        jsonb_build_object('label', 'Ceilings', 'hours', 1, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Cornices', 'hours', 0.5, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Window frames', 'hours', 0.5, 'product', 'Dulux Aquanamel Semi Gloss', 'count', 1),
        jsonb_build_object('label', 'Doors', 'hours', 0.5, 'product', 'Dulux Aquanamel Semi Gloss', 'count', 1))),
      jsonb_build_object('title', 'Hallway', 'meta', '6.0 × 1.2 m · 2.7 m ceiling', 'photo', 'hallway.jpg',
        'dims', jsonb_build_object('l', 6.0, 'w', 1.2, 'h', 2.7), 'surfaces', jsonb_build_array(
        jsonb_build_object('label', 'Walls', 'hours', 1.5, 'product', 'Dulux Wash&Wear Low Sheen'),
        jsonb_build_object('label', 'Ceilings', 'hours', 0.5, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Skirting boards', 'hours', 0.5, 'product', 'Dulux Aquanamel Semi Gloss'),
        jsonb_build_object('label', 'Doors', 'hours', 1, 'product', 'Dulux Aquanamel Semi Gloss', 'count', 3)))
    ));
$$;

-- The frozen document now carries dims per area and count per item surface (snapshot.ts shape).
create or replace function public.demo_property_snapshot(p_ref text)
returns jsonb language plpgsql immutable as $$
declare t jsonb := public.demo_property_template(); v_areas jsonb := '[]'; a jsonb; s jsonb; i integer := 0; j integer; v_surfaces jsonb; v_s jsonb;
begin
  for a in select * from jsonb_array_elements(t->'areas') loop
    v_surfaces := '[]'; j := 0;
    for s in select * from jsonb_array_elements(a->'surfaces') loop
      v_s := jsonb_build_object(
        'key', format('a%s:%s', i, j), 'label', s->>'label', 'coats', 2, 'product', s->>'product',
        'prep', '', 'hours', (s->>'hours')::numeric, 'status', 'not_started');
      if s ? 'count' then v_s := v_s || jsonb_build_object('count', (s->>'count')::integer); end if;
      v_surfaces := v_surfaces || v_s;
      j := j + 1;
    end loop;
    v_areas := v_areas || jsonb_build_object(
      'id', format('a%s', i), 'title', a->>'title', 'side', 'interior', 'finishCode', 'PG-3',
      'finishOverridden', false, 'photos', '[]'::jsonb, 'dims', a->'dims', 'surfaces', v_surfaces);
    i := i + 1;
  end loop;
  return jsonb_build_object(
    'version', 1, 'woRef', p_ref, 'status', 'issued',
    'jobTitle', t->>'title', 'jobAddress', t->>'address',
    'contactFirstName', 'Demo', 'contactPhone', '', 'startDate', null,
    'accessNotes', 'Practice job. Nothing here is real.', 'crewNotes', '',
    'levelOfFinish', 'Level 3 — Good', 'finishCode', 'PG-3',
    'contractorName', '', 'contractorPaymentCents', (t->>'paymentCents')::integer,
    'materials', t->'materials', 'areas', v_areas, 'exclusions', '[]'::jsonb,
    'company', jsonb_build_object('name', 'Paint Group', 'phone', '', 'logoUrl', ''));
end $$;

-- ---- 2. seed: colours confirmed, pre-start ticked, one office photo per room ---------
create or replace function public.demo_property_seed(p_contractor_id uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_existing uuid; v_est uuid; v_wo uuid; v_ref text; t jsonb; a jsonb; s jsonb; m jsonb;
        i integer := 0; j integer; v_start date; v_end date; v_sort integer := 0; v_colours jsonb := '{}';
begin
  v_cid := public.demo_property_owner(p_contractor_id);
  if v_cid is null then return 'error:not_allowed'; end if;
  if (select employment_type from public.contractors where id = v_cid) = 'employee' then
    return 'error:employee';   -- employees see jobs by assignment; their demo arrives with the worker induction (Step 3a)
  end if;

  select id into v_existing from public.work_orders where contractor_id = v_cid and is_demo limit 1;
  if v_existing is not null then return 'exists:' || v_existing; end if;

  t := public.demo_property_template();
  v_ref := 'WO-DEMO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));

  -- The colour schedule is decided: the pre-start colours item reads work_orders.colours.
  for m in select * from jsonb_array_elements(t->'materials') loop
    v_colours := v_colours || jsonb_build_object(m->>'product', jsonb_build_object('status', 'confirmed', 'name', m->>'colourName', 'hex', m->>'colourHex'));
  end loop;

  insert into public.estimates (status, source, level_of_finish, customer_id, total_cents, accepted_name, accepted_at, title, is_demo)
    values ('accepted', 'manual', 3, null, (t->>'contractCents')::integer, 'Demo Customer', now(), t->>'title', true)
    returning id into v_est;

  insert into public.work_orders (estimate_id, wo_ref, share_token, status, stage, stage_entered_at, contractor_id,
                                  issued_at, contractor_payment_cents, access_notes, wo_snapshot, colours, is_demo)
    values (v_est, v_ref,
            replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
            'issued', 'offered', now(), v_cid, now(), (t->>'paymentCents')::integer,
            'Practice job. Nothing here is real.', public.demo_property_snapshot(v_ref), v_colours, true)
    returning id into v_wo;

  -- The office has done its pre-start work (the issued_at trigger seeded the list): every
  -- item ticked, so the painter is not blocked by a list the slides never mention.
  update public.wo_checklist_items set done_at = now() where work_order_id = v_wo and phase = 'pre_start' and done_at is null;

  -- The tick list, straight from the template (one row per surface, keyed to the document),
  -- and one office photo per room, pointing at the shared demo files in the wo-photos bucket.
  for a in select * from jsonb_array_elements(t->'areas') loop
    j := 0;
    for s in select * from jsonb_array_elements(a->'surfaces') loop
      insert into public.wo_surfaces (work_order_id, heading, heading_meta, label, surface_key, sort, is_demo)
        values (v_wo, a->>'title', a->>'meta', s->>'label', format('a%s:%s', i, j), v_sort, true);
      v_sort := v_sort + 1; j := j + 1;
    end loop;
    if coalesce(a->>'photo', '') <> '' then
      insert into public.wo_photos (work_order_id, area, kind, storage_path, caption, is_demo)
        values (v_wo, a->>'title', 'reference', 'demo/reference/' || (a->>'photo'), a->>'title' || ' as we found it', true);
    end if;
    i := i + 1;
  end loop;

  -- A live offer, next Monday for five working days (Module 2 shows it waiting; Module 10 accepts it).
  v_start := current_date + (((8 - extract(isodow from current_date)::integer) % 7) + case when extract(isodow from current_date) = 1 then 7 else 0 end);
  v_end := v_start + 4;
  insert into public.booking_offers (work_order_id, contractor_id, state, start_date, end_date, hours_allowance, payment_cents,
                                     staff_note, expires_at, is_demo)
    values (v_wo, v_cid, 'offered', v_start, v_end, (t->>'hours')::numeric, (t->>'paymentCents')::integer,
            'Practice job for the induction. Accept it when the slides say so.', now() + interval '30 days', true);

  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (v_cid, 'demo_seeded', jsonb_build_object('work_order_id', v_wo, 'wo_ref', v_ref), auth.uid());
  return 'ok:' || v_wo;
end $$;

-- ---- 3. the shared demo photos: any signed-in painter may sign a demo/ path ------------
-- The files carry nothing private (five empty rooms). The wo_photos ROWS stay scoped to the
-- job by wo_photo_access, so a painter only ever sees them on their own practice job.
drop policy if exists wo_photos_demo_select on storage.objects;
create policy wo_photos_demo_select on storage.objects
  for select to authenticated
  using (bucket_id = 'wo-photos' and split_part(name, '/', 1) = 'demo');

-- ---- 4. grants unchanged: the helpers stay private, the two entry points stay callable ----
revoke all on function public.demo_property_template() from public, authenticated, anon;
revoke all on function public.demo_property_snapshot(text) from public, authenticated, anon;
revoke all on function public.demo_property_seed(uuid) from public, anon;
grant execute on function public.demo_property_seed(uuid) to authenticated;

-- ---- 5. read-back: compare every column to its _expect_ before calling this live ----------
select
  jsonb_array_length(public.demo_property_template()->'areas') as areas, 5 as _expect_areas,
  (select sum((s->>'hours')::numeric) from jsonb_array_elements(public.demo_property_template()->'areas') a, jsonb_array_elements(a->'surfaces') s) as hours, 40 as _expect_hours,
  (select count(*) from jsonb_array_elements(public.demo_property_template()->'areas') a, jsonb_array_elements(a->'surfaces') s) as surfaces, 27 as _expect_surfaces,
  (select count(*) from jsonb_array_elements(public.demo_property_snapshot('WO-DEMO-TEST')->'areas') a where a ? 'dims') as areas_with_dims, 5 as _expect_areas_with_dims,
  (select count(*) from jsonb_array_elements(public.demo_property_snapshot('WO-DEMO-TEST')->'areas') a, jsonb_array_elements(a->'surfaces') s where s ? 'count') as counted_surfaces, 8 as _expect_counted_surfaces,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'wo_photos_demo_select') as demo_photo_policy, 1 as _expect_demo_photo_policy,
  has_function_privilege('authenticated', 'public.demo_property_seed(uuid)', 'execute') as seed_callable, true as _expect_seed_callable,
  has_function_privilege('authenticated', 'public.demo_property_template()', 'execute') as template_callable, false as _expect_template_callable;

insert into public._prod_migrations(name) values ('20270275000000_demo_job_gaps.sql') on conflict (name) do nothing;
