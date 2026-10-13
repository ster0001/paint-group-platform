-- 20270260 · Payments merge Step 8 — a draft final follows the invoices before it (§6.3).
--
-- ADDITIVE ONLY: one trigger, one staff function. No invoice row is changed by
-- this file.
--
-- The defect (4/20 Cockatoo St, 12 Oct): the draft final read $4,223.37, the
-- whole contract, though the $2,111.69 deposit was paid. `invoice_draft_final`
-- totals "adjusted contract − invoiced", and a DRAFT deposit is not invoiced
-- (ledger rule, lib/invoicing/ledger.ts invoicedCents). The final was drafted
-- at sign-off while the deposit was still a draft; the deposit was then paid,
-- which issues it silently — and nothing re-worked the final.
--
--   · Trigger `invoices_redraft_final`: when an invoice other than the final
--     is issued (leaves draft) or voided after issue, a standing DRAFT final on
--     the same job is drafted again through `invoice_draft_final` (which
--     already replaces a standing draft final, 20261112). A sent final is never
--     touched. Hand edits to that draft are replaced — the same rule as a
--     re-sign after reopen.
--   · `invoice_redraft_final(estimate)`: the panel's Redraft button for the
--     drafts already wrong before this trigger existed (staff only).

set lock_timeout = '15s';

create or replace function public.invoices_redraft_final()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'final'
     and ((old.status = 'draft' and new.status not in ('draft', 'void'))
          or (old.status not in ('draft', 'void') and new.status = 'void'))
     and exists (select 1 from public.invoices f
                  where f.estimate_id = new.estimate_id and f.kind = 'final' and f.status = 'draft') then
    perform public.invoice_draft_final(new.estimate_id);
  end if;
  return null;
end $$;
-- Trigger function: runs as the owner, no caller grant (CLAUDE.md, 20270201).
revoke execute on function public.invoices_redraft_final() from public, anon, authenticated;

drop trigger if exists invoices_redraft_final on public.invoices;
create trigger invoices_redraft_final
  after update of status on public.invoices
  for each row execute function public.invoices_redraft_final();

create or replace function public.invoice_redraft_final(p_estimate_id uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not exists (select 1 from public.invoices
                  where estimate_id = p_estimate_id and kind = 'final' and status = 'draft') then
    return 'error:no_draft_final';
  end if;
  return public.invoice_draft_final(p_estimate_id);
end $$;
revoke execute on function public.invoice_redraft_final(uuid) from public, anon;
grant execute on function public.invoice_redraft_final(uuid) to authenticated;

-- ---- read-back: ONE row, every column equals its _expect_ ---------------------
select
  (select count(*) from pg_trigger where tgname = 'invoices_redraft_final' and not tgisinternal) as redraft_trigger, 1 as _expect_redraft_trigger,
  has_function_privilege('authenticated', 'public.invoices_redraft_final()', 'execute') as trigger_fn_callable, false as _expect_trigger_fn_callable,
  has_function_privilege('authenticated', 'public.invoice_redraft_final(uuid)', 'execute') as redraft_auth, true as _expect_redraft_auth,
  has_function_privilege('anon', 'public.invoice_redraft_final(uuid)', 'execute') as redraft_anon, false as _expect_redraft_anon,
  (select position('is_staff' in prosrc) > 0 from pg_proc where proname = 'invoice_redraft_final') as redraft_guarded, true as _expect_redraft_guarded;

insert into public._prod_migrations(name) values ('20270260000000_payments_final_redraft.sql') on conflict (name) do nothing;
