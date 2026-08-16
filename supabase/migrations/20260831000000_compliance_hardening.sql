-- =============================================================================
-- Security review fixes
--
-- FOUND BY TESTING, not by reading: a contractor could mark themselves insured
-- with no certificate at all. Inserting a contractor_documents row with a
-- made-up file path was enough to flip `offerable` to true, because the
-- offerable rule only checked that file_url was non-empty. That defeats the one
-- control standing between an uninsured painter and a customer's home.
--
-- Two layers go in, because either alone is soft:
--   1. The row must point at a file that ACTUALLY EXISTS in storage, inside
--      that contractor's own folder. Closes "type any string".
--   2. Insurance must be VERIFIED BY STAFF before it counts. Closes "upload any
--      blank PDF and claim it expires in 2099" — which no amount of database
--      logic can judge, because it needs a human to read the certificate.
--
-- Also tightens four functions that were callable by anyone, and drops two that
-- were never called.
-- =============================================================================

-- ---- 1. verification --------------------------------------------------------
alter table public.contractor_documents
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references auth.users (id) on delete set null,
  add column if not exists verify_note text not null default '';

-- ---- 2. the file has to be real ---------------------------------------------
create or replace function public.contractor_doc_file_check()
returns trigger language plpgsql security definer set search_path = public, storage as $$
declare v_owner text;
begin
  if coalesce(new.file_url, '') = '' then
    return new; -- a placeholder row; it can never make anyone offerable
  end if;

  -- Path convention is <contractor_id>/<filename>; anything else is someone
  -- pointing at a file that isn't theirs.
  v_owner := split_part(new.file_url, '/', 1);
  if v_owner is distinct from new.contractor_id::text then
    raise exception 'document path must sit in this contractor''s own folder';
  end if;

  if not exists (
    select 1 from storage.objects
     where bucket_id = 'contractor-docs' and name = new.file_url
  ) then
    raise exception 'no uploaded file at that path — upload the document first';
  end if;

  return new;
end $$;

drop trigger if exists contractor_doc_file_check_t on public.contractor_documents;
create trigger contractor_doc_file_check_t
  before insert or update of file_url on public.contractor_documents
  for each row execute function public.contractor_doc_file_check();

-- ---- 3. offerable now requires a VERIFIED certificate ------------------------
create or replace function public.contractor_recompute_offerable(p_cid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  v_ok := exists (
    select 1 from public.contractor_documents d
    where d.contractor_id = p_cid
      and d.kind = 'insurance'
      and d.file_url <> ''
      and d.verified_at is not null                       -- a human has seen it
      and (d.expires_on is null or d.expires_on >= current_date)
  );
  update public.contractors set offerable = v_ok where id = p_cid;
end $$;

-- Trigger-only. It was executable by anyone, including anonymous visitors.
revoke all on function public.contractor_recompute_offerable(uuid) from public, anon, authenticated;

create or replace function public.verify_contractor_document(
  p_document_id uuid, p_verified boolean, p_note text default ''
) returns text language plpgsql security definer set search_path = public as $$
declare v_cid uuid;
begin
  if not public.is_staff() then return 'error:not_staff'; end if;
  select contractor_id into v_cid from public.contractor_documents where id = p_document_id;
  if v_cid is null then return 'error:not_found'; end if;

  update public.contractor_documents
     set verified_at = case when p_verified then now() else null end,
         verified_by = case when p_verified then auth.uid() else null end,
         verify_note = coalesce(p_note, '')
   where id = p_document_id;

  perform public.contractor_recompute_offerable(v_cid);
  return case when p_verified then 'verified' else 'unverified' end;
end $$;
grant execute on function public.verify_contractor_document(uuid, boolean, text) to authenticated;

-- ---- 4. a contractor must not be able to verify their own paperwork ----------
-- Same trap as before: column privileges are ignored while the table-level grant
-- stands, so revoke the table first and grant back only the safe columns.
revoke insert, update on public.contractor_documents from authenticated;
grant insert (contractor_id, kind, name, file_url, expires_on) on public.contractor_documents to authenticated;
grant update (kind, name, file_url, expires_on) on public.contractor_documents to authenticated;

-- ---- 5. lock down the remaining loose functions ------------------------------
-- Housekeeping only, but it had no business being callable by the public.
revoke all on function public.expire_booking_offers() from public, anon;
grant execute on function public.expire_booking_offers() to authenticated;

-- Never called by the application, and each leaked a little about other people.
drop function if exists public.contractor_is_free(uuid, date, date);
drop function if exists public.work_order_is_accepted(uuid);

-- ---- 6. dead column ---------------------------------------------------------
-- Superseded by contractor_documents; nothing reads it, but it was writable and
-- looks authoritative. Kept (data preservation) but no longer writable.
revoke update (insurance_expiry) on public.contractors from authenticated;
comment on column public.contractors.insurance_expiry is
  'DEPRECATED — superseded by contractor_documents. Nothing reads this.';

-- ---- 7. re-evaluate everyone against the new rule -----------------------------
do $$ declare r record; begin
  for r in select id from public.contractors loop
    perform public.contractor_recompute_offerable(r.id);
  end loop;
end $$;

-- ---- Verification -----------------------------------------------------------
-- As a contractor, this must now FAIL ("no uploaded file at that path"):
--   insert into contractor_documents (contractor_id, kind, file_url, expires_on)
--   values (<own id>, 'insurance', 'made/up/path.pdf', '2030-01-01');
-- And this must fail too (column not granted):
--   update contractor_documents set verified_at = now() where contractor_id = <own id>;
-- Uploading a real file then inserting the row should succeed but leave
-- offerable = false until staff call verify_contractor_document(...).
