-- =============================================================================
-- Live customer view
-- The customer document now lives in estimates.sent_snapshot and is rewritten
-- on every save (so edits propagate to the customer's link). The token page must
-- therefore only become viewable once the estimate has actually been SENT —
-- gate on sent_at rather than on the snapshot merely existing.
-- =============================================================================

create or replace function public.get_estimate_by_token(p_token text)
returns table (
  id uuid, status public.estimate_status, snapshot jsonb, accepted_name text,
  accepted_at timestamptz, declined_reason text, valid_until date,
  sent_at timestamptz, viewed_at timestamptz, selected_options jsonb
)
language sql security definer set search_path = public as $$
  select e.id, e.status, e.sent_snapshot, e.accepted_name, e.accepted_at,
         e.declined_reason, e.valid_until, e.sent_at, e.viewed_at, e.selected_options
  from public.estimates e
  where e.share_token = p_token and e.sent_at is not null
  limit 1;
$$;

grant execute on function public.get_estimate_by_token(text) to anon, authenticated;
