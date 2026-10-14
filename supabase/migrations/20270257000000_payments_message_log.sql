-- 20270257 · Payments merge Step 4 — message follow-up (payments-merge brief §4.4).
--
-- ADDITIVE ONLY: one function. A payment message staff send from Payments →
-- Message is an ordinary estimate-chat reply (estimate_messages, then the
-- `estimate_chat_reply` automation: email with the whole message + a text with
-- the chat link — ⚑P7, Tom 13 Oct: both). This function adds the money side:
-- a `nudge_sent` event on the invoice (the existing event vocabulary), so the
-- invoice's own history shows the chase. Staff only; invoice_events stay
-- RPC-written.
set lock_timeout = '15s';

create or replace function public.invoice_log_message(p_invoice_id uuid, p_template text)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  if not exists (select 1 from public.invoices where id = p_invoice_id) then return 'error:not_found'; end if;
  if p_template is null or p_template not in ('deposit', 'reminder', 'overdue', 'received', 'custom') then
    return 'error:bad_template';
  end if;
  perform public.invoice_event(p_invoice_id, 'nudge_sent', 'staff',
    jsonb_build_object('via', 'chat', 'template', p_template));
  return 'ok:logged';
end $$;
revoke execute on function public.invoice_log_message(uuid, text) from public, anon;
grant execute on function public.invoice_log_message(uuid, text) to authenticated;

-- ---- read-back -----------------------------------------------------------------------------
select
  has_function_privilege('authenticated', 'public.invoice_log_message(uuid, text)', 'execute') as log_message_auth, true as _expect_log_message_auth,
  has_function_privilege('anon', 'public.invoice_log_message(uuid, text)', 'execute') as log_message_anon, false as _expect_log_message_anon;

insert into public._prod_migrations(name) values ('20270257000000_payments_message_log.sql') on conflict (name) do nothing;
