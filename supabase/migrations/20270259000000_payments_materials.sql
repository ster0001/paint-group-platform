-- 20270259 · Payments merge Step 6 — the Materials block (payments-merge brief §4.6).
--
-- ADDITIVE ONLY: two enum values, one nullable column, new functions. No
-- existing cost, intake or document row is changed by this file.
--
--   · `job_cost_category` gains 'materials'. From now on a supplier invoice
--     confirmed from the Materials block is a job cost with that category (it
--     has the recorded → approved → paid flow; material_costs has none), and
--     vendor memory learns 'materials' — the cause of §6.9, where every
--     supplier invoice was filed as 'other'. The rows already filed as 'other'
--     are NOT re-categorised (a bulk update needs Tom's approval, §3A.3): the
--     page counts them as materials by rule, from vendor memory.
--   · `job_cost_status` gains 'void': Delete on a cost waiting for approval
--     (§4.6, ⚑P11). Reversible — job_cost_restore puts it back to recorded —
--     and reporting already ignores 'void' (lib/reporting/load.ts).
--   · Delete / Dismiss on an intake document is the existing cost_intake_reject;
--     cost_intake_restore makes it reversible (back to pending, or to a flagged
--     duplicate). Nothing is ever hard-deleted; the document stays.
--   · Confirm = checked and approved in one press (⚑P9, default on):
--     cost_intake_confirm_materials reads the figures from the EXTRACTED fields
--     (never from the browser), confirms through cost_intake_confirm, then
--     job_cost_approve.
--   · Not for a job: material_costs.overhead — a supplier document confirmed
--     against no job by choice, so it no longer counts as "to match" (§6.8).
--   · Paid per supplier with Undo (⚑P10): job_cost_mark_paid per row, and
--     job_cost_unpay within 10 minutes. Records only.
-- Converges on a re-run.
set lock_timeout = '15s';

alter type public.job_cost_category add value if not exists 'materials';
alter type public.job_cost_status add value if not exists 'void';

alter table public.material_costs add column if not exists overhead boolean;
comment on column public.material_costs.overhead is
  'Payments merge Step 6: true = confirmed as "not for a job" by a person — not in the to-match queue.';

-- ---- Confirm (and approve) a supplier document onto a job ---------------------------------
create or replace function public.cost_intake_confirm_materials(p_id uuid, p_wo uuid default null, p_approve boolean default true)
returns text language plpgsql security definer set search_path = public as $$
declare v public.cost_intake%rowtype; v_wo uuid; v_total bigint; v_ex bigint; v_gst bigint;
        v_res text; v_cost uuid; v_date date; v_no text; v_supplier text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.cost_intake where id = p_id;
  if not found then return 'error:not_found'; end if;
  v_wo := coalesce(p_wo, v.proposed_wo_id);
  if v_wo is null then return 'error:no_job'; end if;

  v_total := nullif(v.extracted ->> 'total_cents', '')::bigint;
  v_ex := nullif(v.extracted ->> 'subtotal_ex_cents', '')::bigint;
  v_gst := nullif(v.extracted ->> 'gst_cents', '')::bigint;
  if v_ex is null and v_total is not null then
    v_gst := coalesce(v_gst, public.gst_from_inc_cents(v_total, public.invoice_setting_num('{gstRatePct}', 10)));
    v_ex := v_total - v_gst;
  elsif v_gst is null and v_ex is not null then
    v_gst := coalesce(v_total - v_ex, 0);
  end if;
  if v_ex is null then return 'error:unread_amount'; end if;

  v_no := coalesce(nullif(trim(v.extracted ->> 'invoice_no'), ''), '');
  v_supplier := coalesce(nullif(trim(v.extracted ->> 'supplier'), ''), 'Supplier');
  v_date := case when (v.extracted ->> 'invoice_date') ~ '^\d{4}-\d{2}-\d{2}$' then (v.extracted ->> 'invoice_date')::date end;

  v_res := public.cost_intake_confirm(p_id, 'job_cost', v_wo, v.proposed_vendor_id, v_supplier, 'materials'::public.job_cost_category,
    trim(v_supplier || ' ' || v_no), v_ex::integer, coalesce(v_gst, 0)::integer, v_no, v_date, null, 'account');
  if v_res not like 'ok:%' then return v_res; end if;
  v_cost := substring(v_res from 4)::uuid;
  if p_approve then
    v_res := public.job_cost_approve(v_cost);
    if v_res not like 'ok:%' then raise exception 'cost_intake_confirm_materials: approve refused (%)', v_res; end if;
  end if;
  return 'ok:' || v_cost::text;
end $$;
revoke execute on function public.cost_intake_confirm_materials(uuid, uuid, boolean) from public, anon;
grant execute on function public.cost_intake_confirm_materials(uuid, uuid, boolean) to authenticated;

-- ---- Not for a job: a supplier document that is overhead, by choice ----------------------------
create or replace function public.cost_intake_not_for_job(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.cost_intake%rowtype; v_total bigint; v_res text; v_supplier text; v_date date;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.cost_intake where id = p_id;
  if not found then return 'error:not_found'; end if;
  v_total := nullif(v.extracted ->> 'total_cents', '')::bigint;
  if v_total is null then return 'error:unread_amount'; end if;
  v_supplier := coalesce(nullif(trim(v.extracted ->> 'supplier'), ''), 'Supplier');
  v_date := case when (v.extracted ->> 'invoice_date') ~ '^\d{4}-\d{2}-\d{2}$' then (v.extracted ->> 'invoice_date')::date end;
  v_res := public.cost_intake_confirm(p_id, 'material_cost', null, v.proposed_vendor_id, v_supplier, 'materials'::public.job_cost_category,
    '', v_total::integer, 0, coalesce(v.extracted ->> 'invoice_no', ''), v_date, null, 'account');
  if v_res not like 'ok:%' then return v_res; end if;
  update public.material_costs set overhead = true where id = substring(v_res from 4)::uuid;
  return v_res;
end $$;
revoke execute on function public.cost_intake_not_for_job(uuid) from public, anon;
grant execute on function public.cost_intake_not_for_job(uuid) to authenticated;

-- ---- Restore a deleted / dismissed document ----------------------------------------------------
create or replace function public.cost_intake_restore(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.cost_intake%rowtype; v_to text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.cost_intake where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  -- Only a document a person set aside: rejected, or a duplicate dismissed. A confirmed one has a cost row.
  if v.resulting_id is not null or not (v.status = 'rejected' or (v.status = 'duplicate' and v.confirmed_at is not null)) then
    return 'error:not_deleted';
  end if;
  v_to := case when v.status = 'duplicate' or v.duplicate_of is not null then 'duplicate' else 'pending' end;
  update public.cost_intake set status = v_to, confirmed_by = null, confirmed_at = null where id = p_id;
  return 'ok:' || v_to;
end $$;
revoke execute on function public.cost_intake_restore(uuid) from public, anon;
grant execute on function public.cost_intake_restore(uuid) to authenticated;

-- ---- Delete / restore a cost waiting for approval --------------------------------------------------
create or replace function public.job_cost_void(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.job_costs%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.job_costs where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'recorded' then return 'error:bad_state'; end if;
  update public.job_costs set status = 'void' where id = p_id;
  return 'ok:void';
end $$;
revoke execute on function public.job_cost_void(uuid) from public, anon;
grant execute on function public.job_cost_void(uuid) to authenticated;

create or replace function public.job_cost_restore(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.job_costs%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.job_costs where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'void' then return 'error:not_deleted'; end if;
  update public.job_costs set status = 'recorded' where id = p_id;
  return 'ok:recorded';
end $$;
revoke execute on function public.job_cost_restore(uuid) from public, anon;
grant execute on function public.job_cost_restore(uuid) to authenticated;

-- ---- Undo a supplier Paid ------------------------------------------------------------------------------
create or replace function public.job_cost_unpay(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v public.job_costs%rowtype;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select * into v from public.job_costs where id = p_id for update;
  if not found then return 'error:not_found'; end if;
  if v.status <> 'paid' then return 'error:bad_state'; end if;
  if v.paid_at is null or v.paid_at < now() - interval '10 minutes' then return 'error:undo_expired'; end if;
  update public.job_costs set status = 'approved', paid_at = null where id = p_id;
  return 'ok:approved';
end $$;
revoke execute on function public.job_cost_unpay(uuid) from public, anon;
grant execute on function public.job_cost_unpay(uuid) to authenticated;

-- ---- read-back -------------------------------------------------------------------------------------------
select
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'job_cost_category' and e.enumlabel = 'materials') as materials_category, true as _expect_materials_category,
  exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'job_cost_status' and e.enumlabel = 'void') as void_status, true as _expect_void_status,
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'material_costs' and column_name = 'overhead')::int as overhead_column, 1 as _expect_overhead_column,
  has_function_privilege('authenticated', 'public.cost_intake_confirm_materials(uuid, uuid, boolean)', 'execute') as confirm_auth, true as _expect_confirm_auth,
  has_function_privilege('authenticated', 'public.cost_intake_not_for_job(uuid)', 'execute') as overhead_auth, true as _expect_overhead_auth,
  has_function_privilege('authenticated', 'public.cost_intake_restore(uuid)', 'execute') as restore_auth, true as _expect_restore_auth,
  has_function_privilege('authenticated', 'public.job_cost_void(uuid)', 'execute') as void_auth, true as _expect_void_auth,
  has_function_privilege('authenticated', 'public.job_cost_restore(uuid)', 'execute') as cost_restore_auth, true as _expect_cost_restore_auth,
  has_function_privilege('authenticated', 'public.job_cost_unpay(uuid)', 'execute') as unpay_auth, true as _expect_unpay_auth,
  has_function_privilege('anon', 'public.job_cost_void(uuid)', 'execute') as void_anon, false as _expect_void_anon;

insert into public._prod_migrations(name) values ('20270259000000_payments_materials.sql') on conflict (name) do nothing;
