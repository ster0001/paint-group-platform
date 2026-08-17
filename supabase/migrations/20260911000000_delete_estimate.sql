-- =============================================================================
-- Deleting an estimate
--
-- The rule: an estimate can be deleted unless it has been ACCEPTED. Once a
-- customer has accepted, the estimate is the record of what they agreed to and
-- it stays.
--
-- Two more refusals, which the rule implies rather than states:
--
--   AN ESTIMATE WITH AN INVOICE is never deletable, whatever its status.
--   `invoices.estimate_id` is ON DELETE SET NULL, not cascade - so deleting
--   would leave a money record floating with nothing to explain it. That is
--   worse than refusing.
--
--   AN ESTIMATE WITH A WORK ORDER is never deletable either. Work orders
--   cascade, and so do the booking offers hanging off them, so a delete could
--   silently remove a job a contractor has been offered or has accepted.
--
-- In practice acceptance is what creates both, so these two only fire on
-- something that has gone sideways - which is exactly when you want a refusal
-- rather than a cascade.
--
-- Everything else attached to an estimate is genuinely its own and cascades:
-- areas, lines, options, events, views, questions, follow-ups, and the AI
-- extraction rows (sources, runs, envelopes, defects).
--
-- The DELETE privilege is revoked from client roles so this function is the
-- only way through - the same lock-down as every other state change in this
-- schema.
-- =============================================================================

create or replace function public.delete_estimate(p_estimate_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_status text;
  v_invoices int;
  v_work_orders int;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;

  select status into v_status from public.estimates where id = p_estimate_id for update;
  if v_status is null then return 'error:not_found'; end if;

  if v_status = 'accepted' then return 'error:accepted'; end if;

  select count(*) into v_invoices from public.invoices where estimate_id = p_estimate_id;
  if v_invoices > 0 then return 'error:has_invoice'; end if;

  select count(*) into v_work_orders from public.work_orders where estimate_id = p_estimate_id;
  if v_work_orders > 0 then return 'error:has_work_order'; end if;

  delete from public.estimates where id = p_estimate_id;
  return 'ok:deleted';
end $$;

revoke all on function public.delete_estimate(uuid) from public, anon;
grant execute on function public.delete_estimate(uuid) to authenticated;

-- The only path is the function above. (Column privileges are ignored while a
-- table-level grant stands, so the table grant is what has to go.)
revoke delete on public.estimates from authenticated;

-- ---- Verification -----------------------------------------------------------
-- As staff:
--   select public.delete_estimate('<a draft estimate id>');   -- ok:deleted
--   select public.delete_estimate('<an accepted estimate>');  -- error:accepted
-- And the back door is shut:
--   delete from estimates where id = '<any id>';              -- permission denied
