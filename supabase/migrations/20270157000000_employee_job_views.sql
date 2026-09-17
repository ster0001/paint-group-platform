-- =============================================================================
-- Employed painters — Session 3: the employee's own reads, and "can't make it"
-- (docs/briefs/claude-code-brief-employed-painters.md §3.3, §6 Session 3, ruling 11)
--
-- 20270153 took every money table away from an employee at the policy. This
-- file gives them their jobs back through TWO functions that return a shape
-- with no money in it — the `view=employee` contract (lib/painters/
-- employeeView.ts) made real in SQL. An employee's browser never asks
-- work_orders; it asks employee_jobs(), and PostgREST answers only that.
--
-- jsonb_strip_money(): the frozen work-order document (wo_snapshot) carries
-- contractorPaymentCents and, on option fragments, other cents. Rather than
-- trust a list of key names that a future snapshot field could slip past,
-- the strip walks the whole document and drops EVERY key that looks like
-- money — the same vocabulary the adversarial test greps for
-- (lib/painters/money.ts MONEY_KEY_RE). Absent, not zeroed.
-- =============================================================================

-- ---- 1. The strip -------------------------------------------------------------
create or replace function public.jsonb_strip_money(p jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  out jsonb;
  k text; v jsonb;
begin
  if p is null then return null; end if;
  case jsonb_typeof(p)
    when 'object' then
      out := '{}'::jsonb;
      for k, v in select * from jsonb_each(p) loop
        -- Mirror of MONEY_KEY_RE: cents, price/pricing, rate as its own word
        -- or segment, hourly, margin, amount, offer, invoice, payment, gst,
        -- rcti, payable, remittance.
        -- Case-SENSITIVE on purpose: a case-blind match ate gst_registered
        -- (starts with gst) and accurate (ends in rate). Explicit classes,
        -- exactly as MONEY_KEY_RE spells them.
        if k ~ '([Cc]ents|[Pp]ric(e|ing)|(^|_)[Rr]ates?$|[a-z]Rates?$|[Hh]ourly|[Mm]argin|[Aa]mount|[Oo]ffer|[Ii]nvoice|[Pp]ayment|(^|_)[Gg]st$|^GST$|[Rr]cti|RCTI|[Pp]ayable|[Rr]emittance)' then
          continue;
        end if;
        out := out || jsonb_build_object(k, public.jsonb_strip_money(v));
      end loop;
      return out;
    when 'array' then
      select coalesce(jsonb_agg(public.jsonb_strip_money(e)), '[]'::jsonb) into out
        from jsonb_array_elements(p) e;
      return out;
    else
      return p;
  end case;
end $$;

-- ---- 2. The employee's jobs -------------------------------------------------
-- One row per live assignment for the caller. SECURITY DEFINER so it can read
-- work_orders on the employee's behalf; the caller must be an employee and
-- only ever sees their own rows. Time budget = the document's hours and the
-- office's day count — never a rate.
create or replace function public.employee_jobs(p_work_order_id uuid default null)
returns table (
  work_order_id uuid, wo_ref text, stage text, status text, issued_at timestamptz, viewed_at timestamptz,
  job_start date, job_end date, my_start date, my_end date,
  assignment_id uuid, is_lead boolean, accepted_at timestamptz, crew_size integer,
  walkthrough_required boolean, colours jsonb, doc jsonb,
  budget_hours numeric, budget_days integer
)
language sql stable security definer set search_path = public as $$
  select
    w.id, w.wo_ref, w.stage::text, w.status::text, w.issued_at, w.viewed_at,
    w.start_date, w.end_date, a.start_date, a.end_date,
    a.id, a.is_lead, a.accepted_at,
    (select count(*)::int from public.wo_assignments x
      where x.work_order_id = w.id and x.status <> 'released'),
    coalesce(w.walkthrough_required, true), coalesce(w.colours, '{}'::jsonb),
    public.jsonb_strip_money(w.wo_snapshot),
    (select coalesce(sum((s->>'hours')::numeric), 0)
       from jsonb_array_elements(coalesce(w.wo_snapshot->'areas', '[]'::jsonb)) ar,
            jsonb_array_elements(coalesce(ar->'surfaces', '[]'::jsonb)) s),
    greatest(1, (w.end_date - w.start_date) + 1)
  from public.wo_assignments a
  join public.work_orders w on w.id = a.work_order_id
  where public.is_employee()
    and a.contractor_id = public.current_contractor_id()
    and a.status <> 'released'
    and w.issued_at is not null
    and (p_work_order_id is null or w.id = p_work_order_id)
  order by a.start_date nulls last
$$;
grant execute on function public.employee_jobs(uuid) to authenticated;

-- ---- 3. "Can't make it" (ruling 11) -----------------------------------------
-- The painter flags a day they cannot do, with a reason. It raises the
-- Reassign item on the office's queue and changes NOTHING about the
-- assignment — the office decides. Once per assignment until the office
-- moves the dates or takes them off (the queue reads the event log).
create or replace function public.assignment_cant_make_it(p_assignment_id uuid, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_a public.wo_assignments%rowtype;
begin
  select * into v_a from public.wo_assignments where id = p_assignment_id;
  if not found then return 'error:not_found'; end if;
  if v_a.contractor_id is distinct from public.current_contractor_id() then return 'error:not_yours'; end if;
  if v_a.status = 'released' then return 'error:released'; end if;
  if length(coalesce(p_reason, '')) > 300 then return 'error:reason_too_long'; end if;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
  values (v_a.work_order_id, 'assignment_cant_make_it', auth.uid(), 'contractor',
          jsonb_build_object('assignment_id', p_assignment_id, 'contractor_id', v_a.contractor_id,
                             'start_date', v_a.start_date, 'end_date', v_a.end_date,
                             'reason', coalesce(p_reason, '')));
  return 'ok:flagged';
end $$;
grant execute on function public.assignment_cant_make_it(uuid, text) to authenticated;

-- Is a can't-make-it flag standing on this assignment? Standing = raised after
-- the office last moved the dates (a move answers the flag). The painter's
-- page reads this so it does not offer the button twice; the office's queue
-- derives the same answer from the same events (lib/crm/work-queue.ts).
create or replace function public.employee_flag_state(p_assignment_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when exists (
    select 1 from public.wo_events f
     where f.type = 'assignment_cant_make_it'
       and f.meta->>'assignment_id' = p_assignment_id::text
       and f.created_at > coalesce((
         select max(m.created_at) from public.wo_events m
          where m.type = 'assignment_dates_changed'
            and m.meta->>'assignment_id' = p_assignment_id::text), '-infinity'::timestamptz)
  ) and exists (
    select 1 from public.wo_assignments a
     where a.id = p_assignment_id and a.contractor_id = public.current_contractor_id() and a.status <> 'released'
  ) then 'flagged' else 'clear' end
$$;
grant execute on function public.employee_flag_state(uuid) to authenticated;

-- Painters mark themselves as seen through the same stamp contractors use.
-- contractor_mark_wo_viewed reads work_orders by contractor_id; an employee
-- who is not the lead is not that column, so their view goes unstamped —
-- harmless, the assignment's accepted_at is the fact the office cares about.

-- ---- Read-back: read this, don't assume it ----------------------------------
select
  (select public.jsonb_strip_money('{"a":1,"contractorPaymentCents":5,"areas":[{"hours":2,"priceCents":9,"surfaces":[{"hours":1,"offerPct":0.7}]}],"gst_registered":true,"hourlyRate":60,"accurate":1}'::jsonb)::text)
    = '{"a": 1, "areas": [{"hours": 2, "surfaces": [{"hours": 1}]}], "accurate": 1, "gst_registered": true}' as strip_ok,
  (select count(*) from pg_proc where proname in ('jsonb_strip_money', 'employee_jobs', 'assignment_cant_make_it', 'employee_flag_state')) = 4 as four_functions,
  (select prosecdef from pg_proc where proname = 'employee_jobs') as employee_jobs_definer;

insert into public._prod_migrations(name) values ('20270157000000_employee_job_views.sql') on conflict (name) do nothing;
