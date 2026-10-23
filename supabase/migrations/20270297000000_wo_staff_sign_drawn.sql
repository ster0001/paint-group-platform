-- =============================================================================
-- The customer signs the walkthrough on the office device with a DRAWN signature (Tom, 23 Oct
-- 2026: a signed signature, not a written name). wo_staff_sign_drawn is wo_staff_sign (20261105)
-- with the signature PNG required and kept on wo_signoff.signature, as the customer link does
-- (20270202); captured_on reads staff_device. wo_staff_sign stays for an approval given by phone
-- or on paper. Converging.
-- =============================================================================
set lock_timeout = '15s';

create or replace function public.wo_staff_sign_drawn(p_work_order_id uuid, p_name text, p_signature text, p_note text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v_wo public.work_orders%rowtype; v_s public.wo_signoff%rowtype; v_token text; v_r text; v_h text;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if coalesce(trim(p_name), '') = '' then return 'error:no_name'; end if;
  if p_signature is null or left(p_signature, 22) <> 'data:image/png;base64,' or length(p_signature) < 60 then return 'error:signature_required'; end if;
  if length(p_signature) > 400000 then return 'error:signature_too_big'; end if;
  select * into v_wo from public.work_orders where id = p_work_order_id;
  if not found then return 'error:not_found'; end if;
  if v_wo.stage is distinct from 'walkthrough' then return 'error:not_at_walkthrough'; end if;

  select * into v_s from public.wo_signoff where work_order_id = p_work_order_id for update;
  if not found then return 'error:no_signoff_row'; end if;
  if v_s.signed_at is not null then return 'ok:already'; end if;

  -- Approve every area the customer has not answered — staff are vouching.
  for v_h in select distinct heading from public.wo_surfaces where work_order_id = p_work_order_id
  loop
    if (v_s.areas -> v_h -> 'approved_at') is null then
      update public.wo_signoff
         set areas = areas || jsonb_build_object(v_h, coalesce(areas -> v_h, '{}'::jsonb)
               || jsonb_build_object('approved_at', now(), 'via', 'staff', 'note', coalesce(p_note, '')))
       where work_order_id = p_work_order_id;
    end if;
  end loop;

  -- A one-shot session token, so wo_sign runs its on-device path unchanged.
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  update public.wo_signoff
     set walkthrough_session_token = v_token,
         walkthrough_session_expires_at = now() + interval '10 minutes'
   where work_order_id = p_work_order_id;

  v_r := public.wo_sign(v_token, p_name, 'on_device', 'staff');
  if v_r <> 'ok:signed' then
    update public.wo_signoff set walkthrough_session_token = null, walkthrough_session_expires_at = null
     where work_order_id = p_work_order_id;
    return v_r;
  end if;

  update public.wo_signoff
     set signature = p_signature, captured_on = 'staff_device',
         report = jsonb_set(coalesce(report, '{}'::jsonb), '{captured_on}', '"staff_device"'::jsonb, true)
   where work_order_id = p_work_order_id;

  insert into public.wo_events (work_order_id, type, actor, actor_kind, meta)
    values (p_work_order_id, 'signed_off_on_staff_device', auth.uid(), 'staff',
            jsonb_build_object('name', trim(p_name), 'note', coalesce(p_note, ''), 'signature', true));
  return 'ok:signed';
end $$;
revoke all on function public.wo_staff_sign_drawn(uuid, text, text, text) from public, anon;
grant execute on function public.wo_staff_sign_drawn(uuid, text, text, text) to authenticated;

-- ---- read-back: compare to the _expect_ values before calling this live ------------------
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'wo_staff_sign_drawn') as drawn_fn, 1 as _expect_drawn_fn,
  (select prosrc like '%signature_required%' from pg_proc where proname = 'wo_staff_sign_drawn' limit 1) as requires_signature, true as _expect_requires_signature,
  has_function_privilege('authenticated', 'public.wo_staff_sign_drawn(uuid, text, text, text)', 'execute') as granted, true as _expect_granted;

insert into public._prod_migrations(name) values ('20270297000000_wo_staff_sign_drawn.sql') on conflict (name) do nothing;
