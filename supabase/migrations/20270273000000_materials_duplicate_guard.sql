-- 20270273 · Materials: two different invoice numbers are two invoices.
--
-- 15 Oct 2026: two Viponds invoices arrived on the same day for the same
-- amount, each with its own invoice number. Guard (b) of the duplicate check
-- (same total + same invoice date + same sender domain inside the Settings
-- window) flagged the second as a possible duplicate even though guard (a)
-- had already seen that the invoice numbers differ. The row then sat in
-- To check with nothing but Dismiss.
--
-- This file replaces cost_intake_set_extraction with one change: guard (b)
-- skips a candidate whose invoice number is present and differs from the
-- document being filed. A document with no invoice number read still falls
-- back to the total + date + sender test, as before.
--
-- The screen side (same PR) lets a flagged document be confirmed, picked a
-- job or recorded anyway, which cost_intake_confirm has always allowed.
-- Converges on a re-run.
set lock_timeout = '15s';

create or replace function public.cost_intake_set_extraction(
  p_id uuid, p_extract_status text, p_extracted jsonb,
  p_model text, p_prompt_version text,
  p_input_tokens integer, p_output_tokens integer, p_cost_cents integer,
  p_proposed_wo uuid, p_proposed_vendor uuid, p_match_reason text
) returns text language plpgsql security definer set search_path = public as $$
declare
  v public.cost_intake%rowtype;
  v_dup uuid;
  v_invoice_no text; v_supplier text; v_total bigint; v_date date; v_domain text;
  v_window numeric;
begin
  if auth.role() <> 'service_role' then
    raise exception 'cost_intake_service_only';
  end if;
  select * into v from public.cost_intake where id = p_id for update;
  if v.id is null then return 'error:not_found'; end if;
  -- Never touch a decided row (confirm/reject wins over a late re-delivery).
  if v.confirmed_at is not null then return 'error:already_decided'; end if;
  if p_extract_status not in ('extracted', 'failed') then return 'error:bad_status'; end if;
  if p_match_reason is not null
     and p_match_reason not in ('order_ref', 'address', 'vendor_memory', 'none') then
    return 'error:bad_match_reason';
  end if;

  update public.cost_intake
     set extracted          = coalesce(p_extracted, '{}'::jsonb),
         extract_status     = p_extract_status,
         model              = p_model,
         prompt_version     = p_prompt_version,
         input_tokens       = p_input_tokens,
         output_tokens      = p_output_tokens,
         cost_cents         = p_cost_cents,
         proposed_wo_id     = p_proposed_wo,
         proposed_vendor_id = p_proposed_vendor,
         match_reason       = coalesce(p_match_reason, 'none')
   where id = p_id;

  if p_extract_status = 'failed' then return 'ok:failed'; end if;

  v_invoice_no := nullif(trim(coalesce(p_extracted ->> 'invoice_no', '')), '');
  v_supplier   := lower(nullif(trim(coalesce(p_extracted ->> 'supplier', '')), ''));
  v_total      := nullif(p_extracted ->> 'total_cents', '')::bigint;
  v_date       := nullif(p_extracted ->> 'invoice_date', '')::date;
  v_domain     := lower(split_part(v.from_email, '@', 2));
  v_window     := public.cost_setting_num('{duplicateWindowDays}', 7);

  -- (a) same vendor + invoice number, across every door
  if v_invoice_no is not null then
    select ci.id into v_dup from public.cost_intake ci
     where ci.id <> p_id
       and ci.status <> 'rejected'
       and lower(coalesce(ci.extracted ->> 'invoice_no', '')) = lower(v_invoice_no)
       and ((p_proposed_vendor is not null and ci.proposed_vendor_id = p_proposed_vendor)
            or (p_proposed_vendor is not null and ci.confirmed_vendor_id = p_proposed_vendor)
            or (v_supplier is not null
                and lower(coalesce(ci.extracted ->> 'supplier', '')) = v_supplier))
     order by ci.created_at
     limit 1;
  end if;

  -- (b) same total + same invoice date + same sender domain, within the window.
  --     Two different invoice numbers are two invoices, whatever the total and
  --     date say (20270273): a candidate whose number is read and differs is skipped.
  if v_dup is null and v_total is not null and v_date is not null and v_domain <> '' then
    select ci.id into v_dup from public.cost_intake ci
     where ci.id <> p_id
       and ci.status <> 'rejected'
       and nullif(ci.extracted ->> 'total_cents', '')::bigint = v_total
       and nullif(ci.extracted ->> 'invoice_date', '')::date = v_date
       and lower(split_part(ci.from_email, '@', 2)) = v_domain
       and ci.created_at > now() - make_interval(days => v_window::int)
       and (v_invoice_no is null
            or nullif(trim(coalesce(ci.extracted ->> 'invoice_no', '')), '') is null
            or lower(trim(ci.extracted ->> 'invoice_no')) = lower(v_invoice_no))
     order by ci.created_at
     limit 1;
  end if;

  if v_dup is not null then
    update public.cost_intake
       set status = 'duplicate', duplicate_of = v_dup
     where id = p_id;
    return 'ok:duplicate';
  end if;

  return 'ok:pending';
end $$;

revoke execute on function public.cost_intake_set_extraction(
  uuid, text, jsonb, text, text, integer, integer, integer, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.cost_intake_set_extraction(
  uuid, text, jsonb, text, text, integer, integer, integer, uuid, uuid, text)
  to service_role;

-- Read-back: the function carries the new clause and only service_role may call it.
select
  position('Two different invoice numbers are two invoices' in pg_get_functiondef(p.oid)) > 0 as has_guard,
  true as _expect_has_guard,
  has_function_privilege('service_role', p.oid, 'execute') as service_can_call,
  true as _expect_service_can_call,
  has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_call,
  false as _expect_authenticated_can_call
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'cost_intake_set_extraction';

insert into public._prod_migrations(name) values ('20270273000000_materials_duplicate_guard.sql') on conflict (name) do nothing;
