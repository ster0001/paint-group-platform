-- 20270269 · Payments — cancel an unpaid deposit and invoice the whole job.
--
-- ADDITIVE ONLY: one staff function. No invoice row is changed by this file.
--
-- The case (8 Penderel Court, Tom 15 Oct 2026): the job was signed off with its
-- 50% deposit (INV-0052, $600.05) sent and viewed but never paid. The final
-- drafted at sign-off netted that deposit off (Less previously invoiced), so
-- nothing could raise ONE invoice for the whole $1,200.10: Invoice in full
-- drafts the balance only, and the row keeps offering Paid on the deposit.
--
--   · `invoice_final_in_full(estimate, reason)`: voids every sent, unpaid
--     deposit or progress claim on the job (through `invoice_void` — the number
--     is burnt, the event is written, the parent_void mirror on its lines flips),
--     removes unsent deposit / progress drafts (the final now asks for that
--     money — the 20270261 rule), then drafts the final through
--     `invoice_draft_final`, which totals adjusted contract − invoiced, and a
--     void is not invoiced. One transaction: a refused void raises and nothing
--     stands half done.
--   · Money already paid on a deposit stops it (`error:has_payments`): the
--     ordinary final nets that money off — exactly what Invoice in full does.
--   · Nothing sent and unpaid (`error:nothing_to_cancel`): Invoice in full is
--     the path; this function never silently becomes it.

set lock_timeout = '15s';

create or replace function public.invoice_final_in_full(p_estimate_id uuid, p_reason text default '')
returns text language plpgsql security definer set search_path = public as $$
declare v record; v_res text; v_reason text; v_n integer := 0;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not exists (select 1 from public.estimates where id = p_estimate_id) then return 'error:not_found'; end if;

  -- Money already taken on a deposit or progress claim stays where it is: the
  -- ordinary final nets it off. Nothing here is voided once a cent has landed.
  if exists (select 1 from public.invoices i
               join public.payments p on p.invoice_id = i.id and p.status = 'succeeded'
              where i.estimate_id = p_estimate_id and i.kind in ('deposit', 'progress')
                and i.status not in ('draft', 'void', 'written_off')) then
    return 'error:has_payments';
  end if;

  v_reason := 'Not paid before the job finished; replaced by the final invoice for the whole job'
              || coalesce(nullif(' — ' || trim(coalesce(p_reason, '')), ' — '), '');

  for v in select id from public.invoices
            where estimate_id = p_estimate_id and kind in ('deposit', 'progress')
              and status in ('issued', 'sent', 'viewed')
            order by created_at
  loop
    v_res := public.invoice_void(v.id, v_reason);
    if v_res <> 'ok:void' then raise exception 'invoice_final_in_full: void refused (%)', v_res; end if;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then return 'error:nothing_to_cancel'; end if;

  -- An unsent deposit or progress draft would only ask for money the final now
  -- asks for (20270261 §6.2). Only drafts — every sent one was voided above.
  delete from public.invoices
   where estimate_id = p_estimate_id and kind in ('deposit', 'progress') and status = 'draft';

  return public.invoice_draft_final(p_estimate_id);
end $$;
revoke execute on function public.invoice_final_in_full(uuid, text) from public, anon;
grant execute on function public.invoice_final_in_full(uuid, text) to authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ ---------------------
select
  has_function_privilege('authenticated', 'public.invoice_final_in_full(uuid, text)', 'execute') as final_in_full_auth, true as _expect_final_in_full_auth,
  has_function_privilege('anon', 'public.invoice_final_in_full(uuid, text)', 'execute') as final_in_full_anon, false as _expect_final_in_full_anon,
  (select position('is_staff' in prosrc) > 0 from pg_proc where proname = 'invoice_final_in_full') as final_in_full_guarded, true as _expect_final_in_full_guarded,
  (select position('error:has_payments' in prosrc) > 0 from pg_proc where proname = 'invoice_final_in_full') as final_in_full_keeps_paid, true as _expect_final_in_full_keeps_paid,
  (select prosecdef from pg_proc where proname = 'invoice_final_in_full') as final_in_full_definer, true as _expect_final_in_full_definer;

-- PostgREST learns the new function now, not on its next restart (PGRST202 otherwise).
notify pgrst, 'reload schema';

insert into public._prod_migrations(name) values ('20270269000000_invoice_final_in_full.sql') on conflict (name) do nothing;
