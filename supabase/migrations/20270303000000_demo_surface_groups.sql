-- Work order UX follow-up (25 Oct 2026): the induction demo matches the By surface build.
--
-- demo_property_seed writes the practice job tick rows straight into wo_surfaces, so a
-- demo seeded or reset after 20270300 had no surface groups and its list opened By room
-- with no toggle. The seed now runs the one resolver after its rows, as wo_seed_surfaces
-- does, and every demo job that exists is grouped here. Body of the seed is 20270275
-- verbatim plus the one perform.
set lock_timeout = '15s';

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

  -- Work order UX (25 Oct 2026): the demo must match the real thing, so its rows get
  -- their surface groups from the one resolver, exactly as wo_seed_surfaces does.
  perform public.wo_surface_groups_assign(v_wo);

  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (v_cid, 'demo_seeded', jsonb_build_object('work_order_id', v_wo, 'wo_ref', v_ref), auth.uid());
  return 'ok:' || v_wo;
end $$;
revoke all on function public.demo_property_seed(uuid) from public, anon;
grant execute on function public.demo_property_seed(uuid) to authenticated;

-- ---- backfill every demo job, then read back: compare to the _expect_ values ---------------
with backfill as (
  select public.wo_surface_groups_assign(w.id) as n from public.work_orders w where w.is_demo and w.stage <> 'closed'
)
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'demo_property_seed') as seed_fn, 1 as _expect_seed_fn,
  (select prosrc like '%wo_surface_groups_assign%' from pg_proc where pronamespace = 'public'::regnamespace and proname = 'demo_property_seed') as seed_assigns, true as _expect_seed_assigns,
  (select count(*) from public.standards_versions where published_at is not null) as published_standards, 1 as _expect_published_standards_at_least,
  (select coalesce(sum(n), 0) from backfill) as demo_rows_grouped_now,
  (select count(*) from public.work_orders where is_demo and stage <> 'closed') as demo_jobs_open,
  (select count(*) from public.wo_surfaces where is_demo) as demo_rows,
  (select count(*) from public.wo_surfaces where is_demo and group_code is not null) as demo_rows_with_group,
  (select string_agg(distinct label, ', ') from public.wo_surfaces where is_demo and group_code is null) as demo_labels_without_group;

insert into public._prod_migrations(name) values ('20270303000000_demo_surface_groups.sql') on conflict (name) do nothing;
