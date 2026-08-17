-- =============================================================================
-- R2b — the server boundary for estimate send and accept
--
-- TWO HOLES CLOSED.
--
-- 1. accept_estimate took p_total_cents and p_deposit_cents FROM THE CALLER, and
--    that caller is the customer's browser on a public token page. Anyone with
--    the link could accept a $9,800 quote for $1 — the accepted total is what
--    the deposit invoice is raised from. It now derives the figure from the
--    estimate's own stored snapshot, which the server wrote, and ignores what it
--    is handed. The parameters remain only so existing callers don't break.
--
-- 2. Marking an estimate 'sent' was a direct column write from the browser, with
--    nothing checking the estimate was in a sendable state. send_estimate guards
--    the transition and refuses to send an accepted (locked) quote.
--
-- NOT closed here, deliberately: estimates.subtotal_cents / total_cents are
-- still written by the builder on save. Recomputing those server-side needs the
-- service-role key in the server environment (CLAUDE.md permits this; the app
-- has no such key today). Flagged in docs rather than half-done — see the note
-- at the foot of this file.
-- =============================================================================

-- ---- 1. accept: derive the money, never accept it ---------------------------
create or replace function public.accept_estimate(
  p_token text, p_name text, p_options jsonb, p_total_cents integer, p_deposit_cents integer
) returns text language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_status public.estimate_status; v_share text;
  v_doc jsonb; v_snapshot jsonb;
  v_total integer; v_deposit integer; v_deposit_pct numeric;
begin
  select id, status, share_token, builder_state->'woDoc', sent_snapshot
    into v_id, v_status, v_share, v_doc, v_snapshot
    from public.estimates where share_token = p_token;

  if v_id is null then return 'not_found'; end if;
  if v_status = 'accepted' then return 'already'; end if;
  -- Only a quote the customer has actually been sent can be accepted.
  if v_status is distinct from 'sent' then return 'not_sent'; end if;

  -- THE MONEY COMES FROM THE SNAPSHOT, NOT THE CALLER.
  -- The snapshot is the document the customer is looking at, written by the
  -- server. p_total_cents / p_deposit_cents are ignored on purpose.
  v_total := coalesce(
    nullif((v_snapshot->'totals'->>'totalCents')::integer, 0),
    (v_snapshot->>'totalCents')::integer,
    (select total_cents from public.estimates where id = v_id)
  );
  v_deposit_pct := coalesce((v_snapshot->>'depositPct')::numeric, 50);
  v_deposit := round(v_total * v_deposit_pct / 100.0);

  update public.estimates
     set status = 'accepted', accepted_at = now(), accepted_name = p_name,
         selected_options = p_options, total_cents = coalesce(v_total, total_cents)
   where id = v_id;

  insert into public.estimate_events (estimate_id, type, payload)
    values (v_id, 'accepted',
            jsonb_build_object('name', p_name, 'options', p_options,
                               'total_cents', v_total,
                               'client_claimed_total', p_total_cents,
                               'derived_server_side', true));

  insert into public.invoices (estimate_id, status, amount_cents, issued_on)
    values (v_id, 'draft', greatest(coalesce(v_deposit, 0), 0), current_date);

  insert into public.work_orders (estimate_id, wo_ref, share_token, wo_snapshot, issued_at, status)
    values (
      v_id,
      'WO-' || upper(substr(coalesce(v_share, replace(gen_random_uuid()::text,'-','')), 1, 8)),
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      v_doc,
      case when v_doc is not null then now() else null end,
      case when v_doc is not null then 'issued'::public.wo_status else 'draft'::public.wo_status end
    )
    on conflict (estimate_id) do nothing;

  return 'accepted';
end; $$;
grant execute on function public.accept_estimate(text, text, jsonb, integer, integer) to anon, authenticated;

-- ---- 2. send: a guarded transition ------------------------------------------
create or replace function public.send_estimate(
  p_estimate_id uuid, p_expected_status text, p_valid_until date default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_e public.estimates%rowtype; v_rows integer;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select * into v_e from public.estimates where id = p_estimate_id;
  if not found then return 'error:not_found'; end if;
  if v_e.status = 'accepted' then return 'conflict:accepted'; end if;   -- signed quotes are locked
  if v_e.share_token is null then return 'error:not_saved'; end if;
  if v_e.sent_snapshot is null then return 'error:nothing_to_send'; end if;

  update public.estimates
     set status = 'sent',
         sent_at = coalesce(sent_at, now()),
         valid_until = coalesce(p_valid_until, valid_until, (current_date + 60))
   where id = p_estimate_id
     and status::text = p_expected_status;
  get diagnostics v_rows = row_count;

  if v_rows = 0 then return 'conflict:' || v_e.status; end if;

  insert into public.estimate_events (estimate_id, type, payload)
    values (p_estimate_id, 'sent', jsonb_build_object('by', auth.uid()));

  return 'ok:sent';
end $$;
grant execute on function public.send_estimate(uuid, text, date) to authenticated;

-- ---- 3. the status column is server-owned -----------------------------------
-- Same revoke-then-grant shape used elsewhere: everything the builder legitimately
-- saves stays writable; the lifecycle columns do not.
revoke update on public.estimates from authenticated;
do $$ declare v_cols text; begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into v_cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'estimates'
     and column_name not in (
       'id', 'created_at',
       'status', 'sent_at', 'accepted_at', 'accepted_name', 'accepted_signature'
     );
  execute format('grant update (%s) on public.estimates to authenticated', v_cols);
  raise notice 'estimates: staff may still write: %', v_cols;
end $$;

-- ---- Verification -----------------------------------------------------------
-- Forging the accepted total (the customer-side hole):
--   select public.accept_estimate('<share token>', 'Test', '[]'::jsonb, 1, 1);
--   -> the estimate's total_cents is the SNAPSHOT's total, not 1, and the
--      deposit invoice is a percentage of that. estimate_events records the
--      figure the client claimed alongside the one used.
--
-- Direct status writes must now fail:
--   update estimates set status = 'accepted' where id = '<id>';  -> permission denied
-- while the builder's own save still works:
--   update estimates set title = 'x', builder_state = '{}'::jsonb where id = '<id>';
--
-- Sending a locked quote:
--   select public.send_estimate('<accepted estimate id>', 'accepted');
--   -> 'conflict:accepted'
--
-- STILL OPEN (needs SUPABASE_SERVICE_ROLE_KEY in the server environment):
--   estimates.subtotal_cents / total_cents are written by the builder on save.
--   Once the key exists, saving moves into a server action that recomputes both
--   from builder_state via lib/pricing, and these two columns get revoked too.
