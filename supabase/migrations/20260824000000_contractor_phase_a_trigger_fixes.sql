-- =============================================================================
-- Fix: two Phase A bugs that stopped bank details saving and stopped a
-- contractor ever becoming `offerable`. Both found by testing against the live
-- database after 20260823* were applied.
--
-- BUG 1 — the guard trigger blocked its own escape hatch.
--   contractors_guard fired BEFORE UPDATE and reverted offerable /
--   bank_account_enc / bank_account_last4 whenever `not is_staff()`. But
--   is_staff() reads auth.uid(), which is still the CONTRACTOR inside a
--   SECURITY DEFINER function — so the guard also reverted the writes made by
--   contractor_set_bank() and contractor_recompute_offerable(), the very
--   functions it was meant to let through. Net effect: BSB saved (ungarded),
--   the account number silently did not, and offerable could never turn true.
--
--   Fixed by deleting the trigger and enforcing the same rule with COLUMN-LEVEL
--   PRIVILEGES instead. A revoke can't be talked around by the client, and
--   SECURITY DEFINER functions run as the owner so the RPCs work normally.
--   (A session flag / GUC would NOT be safe here: any client can call
--   set_config() and would then be able to grant themselves offerable.)
--
-- BUG 2 — the document trigger errored, and could recurse.
--   contractor_docs_touch assigned a text CASE to `status`, which is an enum:
--     column "status" is of type contractor_doc_status but expression is of type text
--   so EVERY document insert failed. It also ran an UPDATE on the table it was
--   triggered by, AFTER INSERT OR UPDATE — which re-fires itself.
--
--   Fixed by splitting it: a BEFORE trigger sets NEW.status directly (cast to
--   the enum, no self-UPDATE, no recursion), and an AFTER trigger recomputes
--   offerable.
-- =============================================================================

-- ---- BUG 1: replace the guard trigger with column privileges ----------------
drop trigger if exists contractors_guard_t on public.contractors;
drop function if exists public.contractors_guard();

-- `offerable` is computed by contractor_recompute_offerable(); the bank columns
-- are written only by contractor_set_bank(). Nobody signed in — contractor OR
-- staff — may write them directly. Every other column stays writable, so the
-- portal's company-details form and staff edits are unaffected.
revoke update (offerable, bank_account_enc, bank_account_last4)
  on public.contractors from authenticated;

-- ---- BUG 2: split the document trigger --------------------------------------
-- BEFORE: stamp the row's own status. No UPDATE, so it cannot re-fire itself.
create or replace function public.contractor_doc_status_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  new.status := (case
    when new.file_url = '' then 'pending'
    when new.expires_on is not null and new.expires_on < current_date then 'expired'
    else 'valid'
  end)::public.contractor_doc_status;
  return new;
end $$;

drop trigger if exists contractor_doc_status_stamp_t on public.contractor_documents;
create trigger contractor_doc_status_stamp_t
  before insert or update on public.contractor_documents
  for each row execute function public.contractor_doc_status_stamp();

-- AFTER: recompute whether this contractor can be offered work.
create or replace function public.contractor_docs_touch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.contractor_recompute_offerable(coalesce(new.contractor_id, old.contractor_id));
  return coalesce(new, old);
end $$;

drop trigger if exists contractor_docs_touch_t on public.contractor_documents;
create trigger contractor_docs_touch_t
  after insert or update or delete on public.contractor_documents
  for each row execute function public.contractor_docs_touch();

-- ---- Verification -----------------------------------------------------------
-- Signed in as a contractor:
--   select public.contractor_set_bank('063-000','12345678');
--   select bank_bsb, bank_account_last4 from public.contractors where profile_id = auth.uid();
--     -> expect 063-000 and 5678  (last4 was NULL before this migration)
--   insert a contractor_documents row with kind='insurance' and a file_url
--     -> expect status='valid' and contractors.offerable = true
--   delete it -> expect offerable back to false
