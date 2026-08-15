-- =============================================================================
-- Customer signature on acceptance
-- Stores the drawn signature (a PNG data URL) captured when the customer accepts.
-- A dedicated security-definer RPC lets the anon customer save it against their
-- token without touching the estimates RLS surface. Kept separate from
-- accept_estimate so acceptance keeps working even before this migration is run.
-- =============================================================================

alter table public.estimates add column if not exists accepted_signature text;

create or replace function public.save_estimate_signature(p_token text, p_signature text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from public.estimates where share_token = p_token;
  if v_id is null then return 'not_found'; end if;
  update public.estimates set accepted_signature = p_signature where id = v_id;
  return 'ok';
end; $$;

grant execute on function public.save_estimate_signature(text, text) to anon, authenticated;
