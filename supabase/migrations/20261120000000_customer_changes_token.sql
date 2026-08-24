-- =============================================================================
-- The customer's own page shows their signed changes (Tom, 24 Aug follow-up).
--
-- After signing a variation on /v, the customer lands back on THEIR page
-- (/e/<token>) and sees what changed: each signed variation, anything still
-- awaiting their signature, and the updated job total. Two reads make that
-- possible:
--
-- 1. estimate_changes_by_token — the estimate token's own variations +
--    ledger totals, customer-safe (no contractor money, no ids beyond the
--    variation's own signing token, which is the customer's to use).
-- 2. wo_variation_by_token gains estimate_token, so /v can link back to the
--    customer's page. Return type changes, so drop first (exact signature).
-- =============================================================================

create or replace function public.estimate_changes_by_token(p_token text)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when e.status = 'accepted' then jsonb_build_object(
    'accepted_total_cents', l.accepted_total_cents,
    'adjusted_total_cents', l.adjusted_contract_cents,
    'variations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id,
               'comment', v.comment,
               'category', v.category,
               'price_cents', v.price_cents,
               'credit', v.credit,
               'status', v.status::text,
               'signed_name', v.signed_name,
               'signed_at', v.signed_at,
               -- the signing link, only while it still needs their signature
               'token', case when v.status = 'priced' then v.customer_token end
             ) order by v.created_at)
        from public.wo_variations v
        join public.work_orders w on w.id = v.work_order_id
       where w.estimate_id = e.id
         and v.price_cents is not null
         and v.status in ('priced', 'customer_approved', 'contractor_accepted')
    ), '[]'::jsonb)
  ) end
  from public.estimates e
  cross join lateral public.invoice_ledger(e.id) l
  where e.share_token = p_token
$$;
grant execute on function public.estimate_changes_by_token(text) to anon, authenticated;

drop function if exists public.wo_variation_by_token(text);
create function public.wo_variation_by_token(p_token text)
returns table (id uuid, wo_ref text, category text, comment text, price_cents integer,
               status public.wo_variation_status, job_title text, photo_count integer,
               credit boolean, priced_lines jsonb, signed_name text, signed_at timestamptz,
               adjusted_contract_cents bigint, estimate_token text)
language sql security definer set search_path = public as $$
  select v.id, w.wo_ref, v.category, v.comment, v.price_cents, v.status,
         coalesce(w.wo_snapshot->>'jobTitle', ''),
         (select count(*)::integer from public.wo_photos p where p.variation_id = v.id),
         v.credit, v.priced_lines, v.signed_name, v.signed_at,
         (select l.adjusted_contract_cents from public.invoice_ledger(w.estimate_id) l),
         (select e.share_token from public.estimates e where e.id = w.estimate_id)
    from public.wo_variations v
    join public.work_orders w on w.id = v.work_order_id
   where v.customer_token = p_token
     and v.status in ('priced', 'customer_approved', 'contractor_accepted', 'declined')
   limit 1;
$$;
grant execute on function public.wo_variation_by_token(text) to anon, authenticated;

-- ---- Verification (read this back after running) ----------------------------
select
  (select count(*) from pg_proc where proname = 'estimate_changes_by_token') as changes_fn_1,
  (select prosrc like '%estimate_token%' or pg_get_function_result(oid) like '%estimate_token%'
     from pg_proc where proname = 'wo_variation_by_token' limit 1) as v_returns_estimate_token,
  (select has_function_privilege('anon',
     'public.estimate_changes_by_token(text)', 'execute')) as anon_may_read_changes;
