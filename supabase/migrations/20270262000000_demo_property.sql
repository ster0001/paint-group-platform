-- 20270262 · The demo property — Step 1 of the induction brief
-- (docs/briefs/claude-code-brief-induction-demo-property.md §4, §8 Step 1;
-- Tom's rulings 14 Oct 2026, docs/briefs/induction-demo-property-s0-report.md §7).
--
-- 12 Demo Street is a practice job on a contractor's own account, rendered by
-- the SAME screens as a real job (ruling I3) and walled off from everything
-- that counts: one `is_demo` flag, on the estimate, the work order and every
-- child row the office, money, reporting and status code reads without going
-- through the work order by id. The flag is written ONCE, by this seed; every
-- child row copies it from its parent by trigger, so no later insert — a
-- variation, an invoice, an expense, a call back — can escape the wall.
--
--   · is_demo on estimates + work_orders + 30 child tables, default false.
--   · demo_flag_copy(): BEFORE INSERT on each child, copies the parent's flag
--     by the FK column named in the trigger argument. invoices fall back to
--     the estimate when work_order_id is null (a deposit invoice).
--   · booking_offers_standards_gate skips demo rows: Module 2 hands a new
--     painter the demo OFFER before Module 5's standards sign-off.
--   · contractor_invoice_guard and invoice_guard_delete let a DEMO invoice be
--     deleted whatever its status, so reset can clear what the robots approve.
--   · demo_property_seed(p_contractor_id): the template — interior, Level 3,
--     40 h over 5 booked days, 2 bedrooms, lounge, hallway — as an estimate,
--     an issued work order at `offered`, its tick rows and a live offer.
--     Idempotent: a second call answers exists:<id>. Staff for any contractor;
--     a contractor for themselves (ruling I4).
--   · demo_property_reset(p_contractor_id): delete the contractor's demo rows
--     (RESTRICT-FK'd children first, then the estimate, which cascades) and
--     re-seed, in one transaction. Every delete is pinned to is_demo rows.
--     Writes one contractor_events row (brief §4.2).
--
-- RLS is untouched: the contractor reads their own work order already
-- (work_orders_contractor_read); the demo estimate has no customer, so the
-- customer role reads nothing (brief §7 rule 3, proven in e2e/demo-property.spec.ts).
-- Converges on a re-run.

set lock_timeout = '15s';

-- ---- 1. the flag ---------------------------------------------------------------------------
alter table public.estimates   add column if not exists is_demo boolean not null default false;
alter table public.work_orders add column if not exists is_demo boolean not null default false;
-- The seed and reset look a contractor's demo up by owner; nothing else filters on true.
create index if not exists work_orders_demo_idx on public.work_orders (contractor_id) where is_demo;

-- Written out one per table, no DO loop: the Supabase SQL editor's splitter stops
-- at a multi-line DO block (Tom, 14 Oct: "unterminated dollar-quoted string").
alter table public.booking_offers add column if not exists is_demo boolean not null default false;
alter table public.contractor_expenses add column if not exists is_demo boolean not null default false;
alter table public.contractor_invoices add column if not exists is_demo boolean not null default false;
alter table public.expense_preapprovals add column if not exists is_demo boolean not null default false;
alter table public.invoices add column if not exists is_demo boolean not null default false;
alter table public.job_costs add column if not exists is_demo boolean not null default false;
alter table public.material_costs add column if not exists is_demo boolean not null default false;
alter table public.painter_job_results add column if not exists is_demo boolean not null default false;
alter table public.timesheet_entries add column if not exists is_demo boolean not null default false;
alter table public.wo_appointments add column if not exists is_demo boolean not null default false;
alter table public.wo_assignments add column if not exists is_demo boolean not null default false;
alter table public.wo_callbacks add column if not exists is_demo boolean not null default false;
alter table public.wo_checklist_items add column if not exists is_demo boolean not null default false;
alter table public.wo_day_flags add column if not exists is_demo boolean not null default false;
alter table public.wo_events add column if not exists is_demo boolean not null default false;
alter table public.wo_message_threads add column if not exists is_demo boolean not null default false;
alter table public.wo_photos add column if not exists is_demo boolean not null default false;
alter table public.wo_qa_checks add column if not exists is_demo boolean not null default false;
alter table public.wo_reminder_moments add column if not exists is_demo boolean not null default false;
alter table public.wo_signoff add column if not exists is_demo boolean not null default false;
alter table public.wo_site_visits add column if not exists is_demo boolean not null default false;
alter table public.wo_surfaces add column if not exists is_demo boolean not null default false;
alter table public.wo_updates add column if not exists is_demo boolean not null default false;
alter table public.wo_variations add column if not exists is_demo boolean not null default false;
alter table public.wo_walkthroughs add column if not exists is_demo boolean not null default false;
alter table public.schedule_holds add column if not exists is_demo boolean not null default false;
alter table public.review_requests add column if not exists is_demo boolean not null default false;
alter table public.warranties add column if not exists is_demo boolean not null default false;
alter table public.messages add column if not exists is_demo boolean not null default false;
alter table public.crm_events add column if not exists is_demo boolean not null default false;

-- ---- 2. the copy trigger: a child row carries its parent's flag ----------------------------
-- TG_ARGV[0] is the FK column. A row with no parent (null FK) keeps whatever it
-- was given — for invoices that means the estimate decides (below).
create or replace function public.demo_flag_copy()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_col text := tg_argv[0]; v_wo uuid; v_flag boolean;
begin
  execute format('select ($1).%I', v_col) into v_wo using new;
  if v_wo is not null then
    select is_demo into v_flag from public.work_orders where id = v_wo;
    if v_flag is not null then new.is_demo := v_flag; end if;
  end if;
  return new;
end $$;

create or replace function public.demo_flag_copy_invoice()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_flag boolean;
begin
  if new.work_order_id is not null then
    select is_demo into v_flag from public.work_orders where id = new.work_order_id;
  end if;
  if v_flag is null and new.estimate_id is not null then
    select is_demo into v_flag from public.estimates where id = new.estimate_id;
  end if;
  if v_flag is not null then new.is_demo := v_flag; end if;
  return new;
end $$;

create or replace function public.demo_flag_copy_wo()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_flag boolean;
begin
  select is_demo into v_flag from public.estimates where id = new.estimate_id;
  if v_flag is not null then new.is_demo := v_flag; end if;
  return new;
end $$;

drop trigger if exists t_demo_flag on public.booking_offers;
create trigger t_demo_flag before insert on public.booking_offers for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.contractor_expenses;
create trigger t_demo_flag before insert on public.contractor_expenses for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.contractor_invoices;
create trigger t_demo_flag before insert on public.contractor_invoices for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.expense_preapprovals;
create trigger t_demo_flag before insert on public.expense_preapprovals for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.job_costs;
create trigger t_demo_flag before insert on public.job_costs for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.material_costs;
create trigger t_demo_flag before insert on public.material_costs for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.painter_job_results;
create trigger t_demo_flag before insert on public.painter_job_results for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.timesheet_entries;
create trigger t_demo_flag before insert on public.timesheet_entries for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_appointments;
create trigger t_demo_flag before insert on public.wo_appointments for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_assignments;
create trigger t_demo_flag before insert on public.wo_assignments for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_callbacks;
create trigger t_demo_flag before insert on public.wo_callbacks for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_checklist_items;
create trigger t_demo_flag before insert on public.wo_checklist_items for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_day_flags;
create trigger t_demo_flag before insert on public.wo_day_flags for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_events;
create trigger t_demo_flag before insert on public.wo_events for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_message_threads;
create trigger t_demo_flag before insert on public.wo_message_threads for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_photos;
create trigger t_demo_flag before insert on public.wo_photos for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_qa_checks;
create trigger t_demo_flag before insert on public.wo_qa_checks for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_reminder_moments;
create trigger t_demo_flag before insert on public.wo_reminder_moments for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_signoff;
create trigger t_demo_flag before insert on public.wo_signoff for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_site_visits;
create trigger t_demo_flag before insert on public.wo_site_visits for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_surfaces;
create trigger t_demo_flag before insert on public.wo_surfaces for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_updates;
create trigger t_demo_flag before insert on public.wo_updates for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_variations;
create trigger t_demo_flag before insert on public.wo_variations for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.wo_walkthroughs;
create trigger t_demo_flag before insert on public.wo_walkthroughs for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.schedule_holds;
create trigger t_demo_flag before insert on public.schedule_holds for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.review_requests;
create trigger t_demo_flag before insert on public.review_requests for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.warranties;
create trigger t_demo_flag before insert on public.warranties for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.messages;
create trigger t_demo_flag before insert on public.messages for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.crm_events;
create trigger t_demo_flag before insert on public.crm_events for each row execute function public.demo_flag_copy('work_order_id');
drop trigger if exists t_demo_flag on public.invoices;
create trigger t_demo_flag before insert on public.invoices for each row execute function public.demo_flag_copy_invoice();
drop trigger if exists t_demo_flag on public.work_orders;
create trigger t_demo_flag before insert on public.work_orders for each row execute function public.demo_flag_copy_wo();

-- ---- 3. the offers gate lets the demo offer through --------------------------------------
-- 20270230's body with one line: a demo offer is never a real offer, so the
-- standards sign-off (Module 5) and the Red clearance do not stand in front of
-- the Module 2 practice offer.
create or replace function public.booking_offers_standards_gate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_demo then return new; end if;
  if new.state = 'offered' and public.standards_status_of(new.contractor_id) = 'blocked' then
    raise exception 'standards_not_signed' using hint = 'This painter has not confirmed the finish standards and their grace period has ended.';
  end if;
  if new.state = 'offered' and public.painter_offers_blocked(new.contractor_id) then
    raise exception 'red_no_clearance' using hint = 'This painter is on Red. The owner records "Spoken with, offers allowed" before any new offer.';
  end if;
  return new;
end $$;

-- ---- 3b. the money delete guards let a demo row go -----------------------------------------
-- A submitted contractor invoice and a sent customer invoice can never be
-- deleted by an app path — only drafts, or service_role (20261119, 20261112).
-- demo_property_reset runs as its definer, not service_role, and a demo
-- invoice the robot "approved" is not money. One line in each guard: a demo
-- row may be deleted. Bodies are 20270258's and 20261112's with that line.
create or replace function public.contractor_invoice_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.is_demo then return old; end if;   -- 20270262: the practice job's rows are not money
    if old.status <> 'draft' and current_user <> 'service_role' then
      raise exception 'only draft contractor invoices can be deleted';
    end if;
    return old;
  end if;

  if current_user = 'service_role' then return new; end if;

  if new.status is distinct from old.status then
    if not ( (old.status = 'draft'     and new.status = 'submitted')
          or (old.status = 'submitted' and new.status = 'approved')
          or (old.status = 'approved'  and new.status = 'paid')
          -- ⚑9 RCTI: the platform issues on the contractor's behalf.
          or (old.status = 'draft'     and new.status = 'approved' and old.rcti)
          -- 20270258: Undo of a one-press Approve / Paid, and only from the Undo functions.
          or (old.status = 'approved'  and new.status = 'submitted' and coalesce(current_setting('app.ci_undo', true), '') = 'on')
          or (old.status = 'paid'      and new.status = 'approved'  and coalesce(current_setting('app.ci_undo', true), '') = 'on') ) then
      raise exception 'contractor invoice cannot move % -> %', old.status, new.status;
    end if;
  end if;

  -- Frozen once it stops being a draft (the transition row itself may write
  -- the submit-time recompute, which is why the check is on OLD status).
  if old.status <> 'draft' and (
       new.offer_cents           is distinct from old.offer_cents
    or new.variation_delta_cents is distinct from old.variation_delta_cents
    or new.deduction_lines       is distinct from old.deduction_lines
    or new.subtotal_ex_cents     is distinct from old.subtotal_ex_cents
    or new.gst_cents             is distinct from old.gst_cents
    or new.total_inc_cents       is distinct from old.total_inc_cents
    or new.claimed_ex_cents      is distinct from old.claimed_ex_cents
    or new.number                is distinct from old.number
    or new.entity_snapshot       is distinct from old.entity_snapshot ) then
    raise exception 'a submitted contractor invoice is immutable';
  end if;

  return new;
end $$;

create or replace function public.invoice_guard_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.is_demo then return old; end if;   -- 20270262: the practice job's rows are not money
  -- Every app path — staff, customer, contractor, and every SECURITY DEFINER
  -- RPC (which runs as the function owner, not service_role) — stays blocked.
  if old.status <> 'draft' and current_user <> 'service_role' then
    raise exception 'invoice_undeletable: only drafts may be deleted';
  end if;
  return old;
end $$;

-- ---- 4. the template --------------------------------------------------------------------
-- 12 Demo Street as the brief §4.1 seeds it. Surface labels are the finish
-- standards' surface names, so "What we expect" resolves by label (the demo
-- was never priced from the rate card, so there is no code). Hours total 40.
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
      jsonb_build_object('title', 'Bedroom 1', 'meta', '3.6 × 3.2 m · 2.7 m ceiling', 'surfaces', jsonb_build_array(
        jsonb_build_object('label', 'Walls', 'hours', 5, 'product', 'Dulux Wash&Wear Low Sheen'),
        jsonb_build_object('label', 'Ceilings', 'hours', 2.5, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Cornices', 'hours', 1, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Skirting boards', 'hours', 1.5, 'product', 'Dulux Aquanamel Semi Gloss'),
        jsonb_build_object('label', 'Window frames', 'hours', 1.5, 'product', 'Dulux Aquanamel Semi Gloss'),
        jsonb_build_object('label', 'Doors', 'hours', 1, 'product', 'Dulux Aquanamel Semi Gloss'))),
      jsonb_build_object('title', 'Bedroom 2', 'meta', '3.2 × 3.0 m · 2.7 m ceiling', 'surfaces', jsonb_build_array(
        jsonb_build_object('label', 'Walls', 'hours', 4.5, 'product', 'Dulux Wash&Wear Low Sheen'),
        jsonb_build_object('label', 'Ceilings', 'hours', 2, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Cornices', 'hours', 1, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Skirting boards', 'hours', 1.5, 'product', 'Dulux Aquanamel Semi Gloss'),
        jsonb_build_object('label', 'Window frames', 'hours', 1.5, 'product', 'Dulux Aquanamel Semi Gloss'),
        jsonb_build_object('label', 'Doors', 'hours', 1, 'product', 'Dulux Aquanamel Semi Gloss'))),
      jsonb_build_object('title', 'Lounge', 'meta', '5.0 × 4.2 m · 2.7 m ceiling', 'surfaces', jsonb_build_array(
        jsonb_build_object('label', 'Walls', 'hours', 5, 'product', 'Dulux Wash&Wear Low Sheen'),
        jsonb_build_object('label', 'Ceilings', 'hours', 2.5, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Cornices', 'hours', 1, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Skirting boards', 'hours', 1.5, 'product', 'Dulux Aquanamel Semi Gloss'),
        jsonb_build_object('label', 'Architraves', 'hours', 1, 'product', 'Dulux Aquanamel Semi Gloss'),
        jsonb_build_object('label', 'Window frames', 'hours', 1.5, 'product', 'Dulux Aquanamel Semi Gloss'))),
      jsonb_build_object('title', 'Hallway', 'meta', '6.0 × 1.2 m · 2.7 m ceiling', 'surfaces', jsonb_build_array(
        jsonb_build_object('label', 'Walls', 'hours', 1.5, 'product', 'Dulux Wash&Wear Low Sheen'),
        jsonb_build_object('label', 'Ceilings', 'hours', 0.5, 'product', 'Dulux Ceiling White'),
        jsonb_build_object('label', 'Skirting boards', 'hours', 0.5, 'product', 'Dulux Aquanamel Semi Gloss'),
        jsonb_build_object('label', 'Doors × 3', 'hours', 1, 'product', 'Dulux Aquanamel Semi Gloss')))
    ));
$$;

-- The contractor-safe document the seed freezes (lib/workorder/snapshot.ts shape).
create or replace function public.demo_property_snapshot(p_ref text)
returns jsonb language plpgsql immutable as $$
declare t jsonb := public.demo_property_template(); v_areas jsonb := '[]'; a jsonb; s jsonb; i integer := 0; j integer; v_surfaces jsonb;
begin
  for a in select * from jsonb_array_elements(t->'areas') loop
    v_surfaces := '[]'; j := 0;
    for s in select * from jsonb_array_elements(a->'surfaces') loop
      v_surfaces := v_surfaces || jsonb_build_object(
        'key', format('a%s:%s', i, j), 'label', s->>'label', 'coats', 2, 'product', s->>'product',
        'prep', '', 'hours', (s->>'hours')::numeric, 'status', 'not_started');
      j := j + 1;
    end loop;
    v_areas := v_areas || jsonb_build_object(
      'id', format('a%s', i), 'title', a->>'title', 'side', 'interior', 'finishCode', 'PG-3',
      'finishOverridden', false, 'photos', '[]'::jsonb, 'surfaces', v_surfaces);
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

-- ---- 5. who may seed or reset: staff for anyone, a contractor for themselves --------------
create or replace function public.demo_property_owner(p_contractor_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cid uuid := coalesce(p_contractor_id, public.current_contractor_id());
begin
  if v_cid is null then return null; end if;
  if not (public.is_staff() or v_cid = public.current_contractor_id()) then return null; end if;
  if not exists (select 1 from public.contractors where id = v_cid) then return null; end if;
  return v_cid;
end $$;

-- ---- 6. seed --------------------------------------------------------------------------------
create or replace function public.demo_property_seed(p_contractor_id uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_existing uuid; v_est uuid; v_wo uuid; v_ref text; t jsonb; a jsonb; s jsonb;
        i integer := 0; j integer; v_start date; v_end date; v_sort integer := 0;
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

  insert into public.estimates (status, source, level_of_finish, customer_id, total_cents, accepted_name, accepted_at, title, is_demo)
    values ('accepted', 'manual', 3, null, (t->>'contractCents')::integer, 'Demo Customer', now(), t->>'title', true)
    returning id into v_est;

  insert into public.work_orders (estimate_id, wo_ref, share_token, status, stage, stage_entered_at, contractor_id,
                                  issued_at, contractor_payment_cents, access_notes, wo_snapshot, is_demo)
    values (v_est, v_ref,
            replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
            'issued', 'offered', now(), v_cid, now(), (t->>'paymentCents')::integer,
            'Practice job. Nothing here is real.', public.demo_property_snapshot(v_ref), true)
    returning id into v_wo;

  -- The tick list, straight from the template (one row per surface, keyed to the document).
  for a in select * from jsonb_array_elements(t->'areas') loop
    j := 0;
    for s in select * from jsonb_array_elements(a->'surfaces') loop
      insert into public.wo_surfaces (work_order_id, heading, heading_meta, label, surface_key, sort, is_demo)
        values (v_wo, a->>'title', a->>'meta', s->>'label', format('a%s:%s', i, j), v_sort, true);
      v_sort := v_sort + 1; j := j + 1;
    end loop;
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

-- ---- 7. reset: delete the demo rows, re-seed, one transaction ----------------------------
create or replace function public.demo_property_reset(p_contractor_id uuid default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid; v_wo uuid; v_est uuid; v_old_ref text; v_out text;
begin
  v_cid := public.demo_property_owner(p_contractor_id);
  if v_cid is null then return 'error:not_allowed'; end if;

  select id, estimate_id, wo_ref into v_wo, v_est, v_old_ref
    from public.work_orders where contractor_id = v_cid and is_demo limit 1;

  if v_wo is not null then
    -- RESTRICT-keyed children first (the e2e fixture's purge order), every one pinned to demo rows.
    delete from public.timesheet_entries   where work_order_id = v_wo and is_demo;
    delete from public.contractor_invoices where work_order_id = v_wo and is_demo;
    delete from public.job_costs           where work_order_id = v_wo and is_demo;
    delete from public.contractor_expenses where work_order_id = v_wo and is_demo;
    delete from public.expense_preapprovals where work_order_id = v_wo and is_demo;
    delete from public.material_costs      where work_order_id = v_wo and is_demo;
    delete from public.cost_intake         where proposed_wo_id = v_wo or confirmed_wo_id = v_wo;
    delete from public.invoices            where estimate_id = v_est and is_demo;
    -- Everything else cascades from the estimate.
    delete from public.estimates where id = v_est and is_demo;
  end if;

  v_out := public.demo_property_seed(v_cid);
  if v_out not like 'ok:%' then return v_out; end if;

  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (v_cid, 'demo_reset', jsonb_build_object('previous_wo_ref', v_old_ref, 'work_order_id', substr(v_out, 4)), auth.uid());
  return v_out;
end $$;

-- ---- 8. grants: the two entry points only ------------------------------------------------
revoke all on function public.demo_flag_copy() from public, authenticated, anon;
revoke all on function public.demo_flag_copy_invoice() from public, authenticated, anon;
revoke all on function public.demo_flag_copy_wo() from public, authenticated, anon;
revoke all on function public.demo_property_owner(uuid) from public, authenticated, anon;
revoke all on function public.demo_property_template() from public, authenticated, anon;
revoke all on function public.demo_property_snapshot(text) from public, authenticated, anon;
revoke all on function public.demo_property_seed(uuid) from public, anon;
revoke all on function public.demo_property_reset(uuid) from public, anon;
grant execute on function public.demo_property_seed(uuid) to authenticated;
grant execute on function public.demo_property_reset(uuid) to authenticated;

-- ---- 9. read-back: compare every column to its _expect_ before calling this live ----------
select
  (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'is_demo'
     and table_name in ('estimates', 'work_orders', 'booking_offers', 'contractor_expenses', 'contractor_invoices', 'expense_preapprovals',
                        'invoices', 'job_costs', 'material_costs', 'painter_job_results', 'timesheet_entries', 'wo_appointments', 'wo_assignments',
                        'wo_callbacks', 'wo_checklist_items', 'wo_day_flags', 'wo_events', 'wo_message_threads', 'wo_photos', 'wo_qa_checks',
                        'wo_reminder_moments', 'wo_signoff', 'wo_site_visits', 'wo_surfaces', 'wo_updates', 'wo_variations', 'wo_walkthroughs',
                        'schedule_holds', 'review_requests', 'warranties', 'messages', 'crm_events')) as flag_columns, 32 as _expect_flag_columns,
  (select count(*) from pg_trigger where tgname = 't_demo_flag' and not tgisinternal) as copy_triggers, 31 as _expect_copy_triggers,
  (select count(*) from pg_proc where proname in ('demo_flag_copy', 'demo_flag_copy_invoice', 'demo_flag_copy_wo', 'demo_property_owner',
                                                  'demo_property_template', 'demo_property_snapshot', 'demo_property_seed', 'demo_property_reset')) as functions, 8 as _expect_functions,
  has_function_privilege('authenticated', 'public.demo_property_seed(uuid)', 'execute') as auth_can_seed, true as _expect_auth_can_seed,
  has_function_privilege('authenticated', 'public.demo_property_reset(uuid)', 'execute') as auth_can_reset, true as _expect_auth_can_reset,
  has_function_privilege('anon', 'public.demo_property_seed(uuid)', 'execute') as anon_can_seed, false as _expect_anon_can_seed,
  has_function_privilege('authenticated', 'public.demo_property_template()', 'execute') as auth_can_template, false as _expect_auth_can_template,
  (select prosrc like '%if new.is_demo then return new; end if;%' from pg_proc where proname = 'booking_offers_standards_gate') as gate_skips_demo, true as _expect_gate_skips_demo,
  (select prosrc like '%if old.is_demo then return old; end if;%' from pg_proc where proname = 'contractor_invoice_guard') as ci_guard_skips_demo, true as _expect_ci_guard_skips_demo,
  (select position('app.ci_undo' in prosrc) > 0 and position('immutable' in prosrc) > 0 from pg_proc where proname = 'contractor_invoice_guard') as ci_guard_kept, true as _expect_ci_guard_kept,
  (select prosrc like '%if old.is_demo then return old; end if;%' from pg_proc where proname = 'invoice_guard_delete') as inv_guard_skips_demo, true as _expect_inv_guard_skips_demo,
  (select (public.demo_property_template()->>'hours')::numeric) as template_hours, 40 as _expect_template_hours,
  (select round(sum((s->>'hours')::numeric))::integer from jsonb_array_elements(public.demo_property_template()->'areas') a, jsonb_array_elements(a->'surfaces') s) as surface_hours, 40 as _expect_surface_hours;

insert into public._prod_migrations(name) values ('20270262000000_demo_property.sql') on conflict (name) do nothing;
