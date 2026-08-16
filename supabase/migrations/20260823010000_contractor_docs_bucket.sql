-- =============================================================================
-- Storage bucket for contractor compliance documents
--
-- Phase A created `contractor_documents` rows but no bucket to hold the files.
-- Insurance certificates and licences carry a contractor's business details, so
-- unlike logos this bucket is PRIVATE: files are read through short-lived signed
-- URLs, and only the owning contractor (or staff) can touch them.
--
-- Convention: objects are stored at  <contractor_id>/<filename>  and
-- contractor_documents.file_url holds that path (not a public URL).
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('contractor-docs', 'contractor-docs', false)
on conflict (id) do nothing;

drop policy if exists contractor_docs_read   on storage.objects;
drop policy if exists contractor_docs_write  on storage.objects;
drop policy if exists contractor_docs_update on storage.objects;
drop policy if exists contractor_docs_delete on storage.objects;

-- The first path segment must be the caller's own contractor id. Staff see all.
create policy contractor_docs_read on storage.objects for select to authenticated
  using (
    bucket_id = 'contractor-docs' and (
      public.is_staff()
      or (storage.foldername(name))[1] in (select id::text from public.contractors where profile_id = auth.uid())
    )
  );
create policy contractor_docs_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contractor-docs' and (
      public.is_staff()
      or (storage.foldername(name))[1] in (select id::text from public.contractors where profile_id = auth.uid())
    )
  );
create policy contractor_docs_update on storage.objects for update to authenticated
  using (
    bucket_id = 'contractor-docs' and (
      public.is_staff()
      or (storage.foldername(name))[1] in (select id::text from public.contractors where profile_id = auth.uid())
    )
  );
create policy contractor_docs_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'contractor-docs' and (
      public.is_staff()
      or (storage.foldername(name))[1] in (select id::text from public.contractors where profile_id = auth.uid())
    )
  );

-- Tighten the logo bucket too: Phase A let any signed-in user write to
-- contractor-logos. Reads stay public (logos appear on invoices), but writes are
-- now limited to the owning contractor's folder, or staff.
drop policy if exists contractor_logos_write  on storage.objects;
drop policy if exists contractor_logos_update on storage.objects;
drop policy if exists contractor_logos_delete on storage.objects;

create policy contractor_logos_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'contractor-logos' and (
      public.is_staff()
      or (storage.foldername(name))[1] in (select id::text from public.contractors where profile_id = auth.uid())
    )
  );
create policy contractor_logos_update on storage.objects for update to authenticated
  using (
    bucket_id = 'contractor-logos' and (
      public.is_staff()
      or (storage.foldername(name))[1] in (select id::text from public.contractors where profile_id = auth.uid())
    )
  );
create policy contractor_logos_delete on storage.objects for delete to authenticated
  using (
    bucket_id = 'contractor-logos' and (
      public.is_staff()
      or (storage.foldername(name))[1] in (select id::text from public.contractors where profile_id = auth.uid())
    )
  );

-- ---- Verification -----------------------------------------------------------
-- select id, public from storage.buckets where id in ('contractor-docs','contractor-logos');
