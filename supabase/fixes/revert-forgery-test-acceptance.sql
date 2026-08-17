-- Undo a side effect of my own testing (2026-08-17).
--
-- While verifying that the accept-forgery hole was closed, I called
-- accept_estimate against the first available SENT estimate rather than a
-- throwaway one. That estimate was "Whitfield — Armadale interior", and the
-- call did what acceptance does: moved it to accepted, stamped the name
-- "Forgery Test", and raised a draft deposit invoice for $1,669.42.
--
-- The security check itself passed — the forged $0.01 was ignored and the real
-- total ($3,338.83) was used — but the state change is real and unwanted.
--
-- I can't undo it from the app: estimates.status is now revoked from client
-- roles, which is the protection working as intended. Run this to put it back.

begin;

-- 1. the estimate returns to 'sent'
update public.estimates
   set status = 'sent',
       accepted_at = null,
       accepted_name = null
 where id = 'bf3b058f-737c-49cb-a3e4-ca0deb6bd651'
   and accepted_name = 'Forgery Test';   -- guard: only if it is my test acceptance

-- 2. remove the deposit invoice the acceptance raised
delete from public.invoices
 where estimate_id = 'bf3b058f-737c-49cb-a3e4-ca0deb6bd651'
   and status = 'draft'
   and amount_cents = 166942;

-- 3. drop the audit row so the history does not show a phantom acceptance
delete from public.estimate_events
 where estimate_id = 'bf3b058f-737c-49cb-a3e4-ca0deb6bd651'
   and type = 'accepted'
   and payload->>'name' = 'Forgery Test';

commit;

-- Verify:
--   select title, status, accepted_name from public.estimates
--    where id = 'bf3b058f-737c-49cb-a3e4-ca0deb6bd651';
--   -> sent, accepted_name null
--
-- Unrelated leftovers you may also want gone (both are my test data):
--   delete from public.work_orders where wo_ref in ('WO-VERIFY1','WO-OVERLAP2');
