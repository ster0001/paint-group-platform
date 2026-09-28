-- =============================================================================
-- The customer SIGNS the walkthrough — a drawn signature, not a typed name
-- (Tom, 28 Sep 2026: "a signature box they can sign similar to the box when
-- signing the estimate, rather than a box to type the customer's name").
-- And the remote sign-off no longer dies with a blank error (71 Orrong
-- Crescent: "she couldn't sign off the job, it was coming up with an error").
--
--   · wo_signoff.signature — the PNG data URL, as wo_variations.signature.
--   · wo_sign_drawn(token, signature, device) — validates the drawing, takes
--     the signer's name from the job's accepted estimate (the person the job
--     is for; the customer no longer types anything), signs through wo_sign
--     unchanged, then stores the drawing on the row. Anon-callable like wo_sign:
--     possession of the customer token is the authorisation.
--   · wo_sign: the remote-path gate (20261028 Mode B) refused ANY sign from the
--     customer's own link unless the office had pressed "can't attend" or
--     marked the final walkthrough missed — and the page showed the refusal as
--     a generic error. The gate now holds only while a final walkthrough is
--     BOOKED for today or later (the point of Mode B: they are meant to walk
--     it together). With no final booked, or the booked day passed, the
--     customer's own link signs. The office's "can't attend" still opens it
--     early. The refusal keeps its code (walkthrough_first) and the page now
--     says what it means. Body otherwise 20270164 verbatim.
--
-- Converges on a re-run. Paste with: set lock_timeout = '15s';
-- =============================================================================
set lock_timeout = '15s';

alter table public.wo_signoff add column if not exists signature text;

-- ---- wo_sign: 20270164 body, the remote gate softened (NEW lines marked) ----------
create or replace function public.wo_sign(
  p_token text, p_name text, p_kind public.wo_signoff_kind default 'remote', p_device text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_t record; v_s public.wo_signoff%rowtype; v_via text; v_wo public.work_orders%rowtype;
        v_kind public.wo_signoff_kind; v_captured text;
        v_unapproved text[]; v_years integer := 2; v_start date; v_report jsonb; v_r text;
        v_today date;
begin
  select * into v_t from public.wo_signoff_by_token(p_token);
  if not found then return 'error:not_found'; end if;
  v_s := v_t.s; v_via := v_t.via;
  perform 1 from public.wo_signoff where work_order_id = v_s.work_order_id for update;
  if v_s.signed_at is not null then return 'ok:already'; end if;
  if coalesce(trim(p_name), '') = '' then return 'error:no_name'; end if;

  select * into v_wo from public.work_orders where id = v_s.work_order_id;
  if v_wo.stage is distinct from 'walkthrough' then
    return 'error:not_at_walkthrough:' || v_wo.stage::text;
  end if;

  if p_kind = 'deemed' then
    if v_via <> 'customer' then return 'error:deemed_needs_customer_token'; end if;
    if v_s.deadline_at is null or now() < v_s.deadline_at then
      return 'error:deemed_too_early';
    end if;
    v_kind := 'deemed'; v_captured := null;
  elsif v_via = 'session' then
    v_kind := 'on_device'; v_captured := 'contractor_device';
  else
    -- NEW: the remote path is held only while a final walkthrough is still
    -- ahead (booked today or later) and the office has not opened it.
    v_today := (now() at time zone 'Australia/Melbourne')::date;
    if v_s.client_unavailable_at is null
       and exists (
         select 1 from public.wo_walkthroughs
          where work_order_id = v_s.work_order_id and kind = 'final'
            and status = 'booked' and scheduled_date >= v_today
       ) then
      return 'error:walkthrough_first';
    end if;
    v_kind := 'remote'; v_captured := 'customer_device';
  end if;

  if v_kind <> 'deemed' then
    select array_agg(h) into v_unapproved from (
      select distinct heading as h from public.wo_surfaces
       where work_order_id = v_s.work_order_id
    ) x
    where (v_s.areas -> x.h -> 'approved_at') is null;

    if v_unapproved is not null and array_length(v_unapproved, 1) > 0 then
      return 'error:areas_outstanding:' || array_to_string(v_unapproved, ',');
    end if;
  end if;

  v_start := (now() at time zone 'Australia/Melbourne')::date;

  update public.wo_signoff
     set signed_at = now(), signed_name = trim(p_name),
         signed_kind = v_kind, signed_device = coalesce(p_device, ''),
         captured_on = v_captured,
         walkthrough_session_token = null, walkthrough_session_expires_at = null
   where work_order_id = v_s.work_order_id;

  update public.wo_walkthroughs set status = 'done'
   where work_order_id = v_s.work_order_id and kind = 'final' and status = 'booked'
     and v_kind = 'on_device';

  insert into public.warranties (work_order_id, estimate_id, starts_on, ends_on, years, signed_kind)
    values (v_s.work_order_id, v_wo.estimate_id, v_start,
            (v_start + make_interval(years => v_years))::date, v_years, v_kind)
  on conflict (work_order_id) do nothing;

  insert into public.follow_ups (estimate_id, due_on, done)
    values (v_wo.estimate_id, v_start + 2, false);

  select jsonb_build_object(
    'wo_ref', v_wo.wo_ref,
    'signed_at', now(), 'signed_name', trim(p_name), 'signed_kind', v_kind::text,
    'captured_on', v_captured,
    'warranty_starts', v_start,
    'surfaces', (select coalesce(jsonb_agg(jsonb_build_object(
                     'heading', heading, 'label', label, 'state', state::text,
                     'rectification', rectification) order by sort), '[]'::jsonb)
                   from public.wo_surfaces where work_order_id = v_s.work_order_id),
    'photos', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind::text, 'area', area, 'path', storage_path)), '[]'::jsonb)
                 from public.wo_photos where work_order_id = v_s.work_order_id),
    'variations', (select coalesce(jsonb_agg(jsonb_build_object(
                     'category', category, 'comment', comment, 'status', status::text,
                     'price_cents', price_cents, 'credit', credit,
                     'signed_name', signed_name, 'signed_at', signed_at)), '[]'::jsonb)
                     from public.wo_variations where work_order_id = v_s.work_order_id),
    'qa', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', kind, 'result', result, 'thin_record', thin_record)), '[]'::jsonb)
             from public.wo_qa_checks where work_order_id = v_s.work_order_id),
    'areas', v_s.areas
  ) into v_report;

  update public.wo_signoff set report = v_report where work_order_id = v_s.work_order_id;

  perform public.invoice_draft_final(v_wo.estimate_id);
  perform public.contractor_invoice_draft(v_s.work_order_id);

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (v_s.work_order_id, 'signed_off', auth.uid(),
            case when v_kind = 'deemed' then 'system' else 'customer' end,
            jsonb_build_object('kind', v_kind::text, 'name', trim(p_name),
                               'captured_on', v_captured,
                               'warranty_starts', v_start, 'deemed', v_kind = 'deemed'));

  v_r := public.wo_set_stage(v_s.work_order_id, 'closed',
           case when v_kind = 'deemed' then 'system' else 'customer' end,
           jsonb_build_object('signed_kind', v_kind::text));
  if v_r not like 'ok:%' then
    raise exception 'wo_sign: the job could not be closed (%)', v_r;
  end if;

  return 'ok:signed';
end $$;
grant execute on function public.wo_sign(text, text, public.wo_signoff_kind, text) to anon, authenticated, service_role;

-- ---- the drawn signature -----------------------------------------------------------------
create or replace function public.wo_sign_drawn(p_token text, p_signature text, p_device text default 'web')
returns text language plpgsql security definer set search_path = public as $$
declare v_t record; v_s public.wo_signoff%rowtype; v_name text; v_r text;
begin
  if p_signature is null
     or p_signature not like 'data:image/png;base64,%'
     or length(p_signature) < 100 then
    return 'error:signature_required';
  end if;
  if length(p_signature) > 400000 then return 'error:signature_too_big'; end if;

  select * into v_t from public.wo_signoff_by_token(p_token);
  if not found then return 'error:not_found'; end if;
  v_s := v_t.s;

  -- The signer is the person the job is for: the accepted estimate's name,
  -- else the contact on the sent estimate, else the account's name.
  select coalesce(nullif(trim(e.accepted_name), ''),
                  nullif(trim(e.sent_snapshot ->> 'contactName'), ''),
                  nullif(trim(a.name), ''),
                  'Customer')
    into v_name
    from public.work_orders w
    join public.estimates e on e.id = w.estimate_id
    left join public.accounts a on a.id = e.account_id
   where w.id = v_s.work_order_id;
  v_name := coalesce(v_name, 'Customer');

  v_r := public.wo_sign(p_token, v_name, 'remote', coalesce(p_device, 'web'));
  if v_r <> 'ok:signed' then return v_r; end if;

  update public.wo_signoff set signature = p_signature where work_order_id = v_s.work_order_id;
  return 'ok:signed';
end $$;
grant execute on function public.wo_sign_drawn(text, text, text) to anon, authenticated, service_role;

-- ---- read-back: ONE row, every column equals its _expect_ -----------------------------
select
  (select count(*) = 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'wo_signoff' and column_name = 'signature') as signature_col, true as _expect_signature_col,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'wo_sign_drawn') as drawn_fn, 1 as _expect_drawn_fn,
  (select prosrc like '%scheduled_date >= v_today%' from pg_proc where proname = 'wo_sign' limit 1) as remote_gate_softened, true as _expect_remote_gate_softened,
  (select has_function_privilege('anon', 'public.wo_sign_drawn(text, text, text)', 'execute')) as anon_can_sign, true as _expect_anon_can_sign;

insert into public._prod_migrations(name) values ('20270202000000_wo_sign_drawn_signature.sql') on conflict (name) do nothing;
