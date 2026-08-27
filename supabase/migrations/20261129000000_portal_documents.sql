-- =============================================================================
-- 3a-5 · Documents & warranty (customer portal phase 3)
--
--  1. company_documents — the credentials on display in every portal
--     (public liability certificate first, ⚑13): staff upload once in
--     Settings with an expiry date; every portal serves the current version;
--     an expiring/expired certificate flags amber in the PC console so a
--     lapsed cert can never be the one on display.
--  2. company-docs bucket — PRIVATE; staff read/write; customers read
--     through short-lived signed URLs minted server-side.
--  3. warranty_issues — the "Report an issue" photo-first form's queue.
--     Written ONLY by the server action (service client + ownership check);
--     staff read and resolve; each open row is one PC console card.
--
-- Idempotent; read-backs at the end.
-- =============================================================================

-- ---- 1 · company documents --------------------------------------------------

create table if not exists public.company_documents (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  kind         text not null default 'certificate'
    constraint company_documents_kind_check
    check (kind in ('certificate', 'insurance', 'licence', 'other')),
  storage_path text not null,
  expires_on   date,
  active       boolean not null default true,
  uploaded_by  uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.company_documents is
  'Company credentials shown in every customer portal (Settings → Documents). Expiry drives the amber PC-console flag (⚑13).';

create index if not exists company_documents_active_idx
  on public.company_documents (active, expires_on);

drop trigger if exists t_company_documents_updated on public.company_documents;
create trigger t_company_documents_updated before update on public.company_documents
  for each row execute function public.set_updated_at();

alter table public.company_documents enable row level security;

drop policy if exists company_documents_staff_all on public.company_documents;
create policy company_documents_staff_all on public.company_documents
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- No customer policy: the portal reads ACTIVE documents through the service
-- client and serves the files as short-lived signed URLs.

-- ---- 2 · the bucket ---------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('company-docs', 'company-docs', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists company_docs_read   on storage.objects;
drop policy if exists company_docs_write  on storage.objects;
drop policy if exists company_docs_update on storage.objects;
drop policy if exists company_docs_delete on storage.objects;

create policy company_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'company-docs' and public.is_staff());
create policy company_docs_write on storage.objects for insert to authenticated
  with check (bucket_id = 'company-docs' and public.is_staff());
create policy company_docs_update on storage.objects for update to authenticated
  using (bucket_id = 'company-docs' and public.is_staff());
create policy company_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'company-docs' and public.is_staff());

-- ---- 3 · warranty issues ----------------------------------------------------

create table if not exists public.warranty_issues (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  account_id    uuid references public.accounts (id) on delete restrict,
  note          text not null,
  photo_paths   text[] not null default '{}',
  status        text not null default 'open'
    constraint warranty_issues_status_check check (status in ('open', 'handled')),
  handled_by    uuid references auth.users (id) on delete set null,
  handled_at    timestamptz,
  created_at    timestamptz not null default now()
);
comment on table public.warranty_issues is
  'Customer "Report an issue" submissions (photo-first). Open rows are PC console cards; written only by the server action after an ownership check.';

create index if not exists warranty_issues_open_idx
  on public.warranty_issues (status, created_at desc) where status = 'open';
create index if not exists warranty_issues_wo_idx on public.warranty_issues (work_order_id);

alter table public.warranty_issues enable row level security;

drop policy if exists warranty_issues_staff_all on public.warranty_issues;
create policy warranty_issues_staff_all on public.warranty_issues
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- No customer policy: submissions go through the zod'd server action with the
-- service client + account-chain ownership check; customers see their own
-- reports re-rendered by the same server code.

-- ---- read-backs ------------------------------------------------------------

-- Expect: 2 rows, both rowsecurity = true
select relname, relrowsecurity from pg_class
 where relname in ('company_documents', 'warranty_issues')
   and relnamespace = 'public'::regnamespace order by relname;

-- Expect: company_documents_staff_all, warranty_issues_staff_all
select polname from pg_policy
 where polrelid in ('public.company_documents'::regclass, 'public.warranty_issues'::regclass)
 order by polname;

-- Expect: 1 row — the private bucket with limits
select id, public, file_size_limit from storage.buckets where id = 'company-docs';

-- Expect: 4 storage policies company_docs_*
select polname from pg_policy
 where polrelid = 'storage.objects'::regclass and polname like 'company_docs%'
 order by polname;

-- Expect: warranty_issues.account_id FK is RESTRICT ('r')
select confdeltype from pg_constraint
 where conrelid = 'public.warranty_issues'::regclass
   and confrelid = 'public.accounts'::regclass and contype = 'f';
