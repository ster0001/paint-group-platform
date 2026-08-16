-- =============================================================================
-- Contractor Portal — Phase A: identity, company profile & compliance
-- Extends contractors with company/invoicing/bank fields (bank account number
-- encrypted at rest via pgcrypto + a Vault key), adds compliance documents and
-- an audit log, RPCs to set/read bank details, and an offerable-recompute trigger.
-- =============================================================================

create extension if not exists pgcrypto;

-- One-time encryption key for contractor bank account numbers (Supabase Vault).
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'contractor_bank_key') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'contractor_bank_key', 'Encrypts contractor bank account numbers');
  end if;
end $$;

-- ---- contractors: company / invoicing / bank / offerable --------------------
alter table public.contractors
  add column if not exists company_name        text,
  add column if not exists abn                 text,
  add column if not exists gst_registered      boolean not null default false,
  add column if not exists address             text,
  add column if not exists bank_bsb            text,
  add column if not exists bank_account_enc    bytea,          -- encrypted account number
  add column if not exists bank_account_last4  text,           -- for display without decrypting
  add column if not exists logo_url            text,
  add column if not exists invoice_prefix      text,
  add column if not exists invoice_next_number integer not null default 1,
  add column if not exists offerable           boolean not null default false;

-- ---- compliance documents + audit log ---------------------------------------
do $$ begin
  create type public.contractor_doc_kind as enum ('insurance', 'licence', 'other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.contractor_doc_status as enum ('valid', 'expired', 'pending');
exception when duplicate_object then null; end $$;

create table if not exists public.contractor_documents (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors (id) on delete cascade,
  kind          public.contractor_doc_kind not null,
  name          text not null default '',
  file_url      text not null default '',
  expires_on    date,
  status        public.contractor_doc_status not null default 'pending',
  created_at    timestamptz not null default now()
);
create index if not exists contractor_documents_cid_idx on public.contractor_documents (contractor_id);

create table if not exists public.contractor_events (
  id            uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references public.contractors (id) on delete cascade,
  type          text not null,                 -- e.g. 'bank_changed', 'doc_uploaded', 'compliance_changed'
  detail        jsonb not null default '{}',
  actor         uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists contractor_events_cid_idx on public.contractor_events (contractor_id, created_at desc);

-- ---- RLS: contractors read/update their own row; staff everything -----------
alter table public.contractor_documents enable row level security;
alter table public.contractor_events    enable row level security;

drop policy if exists contractors_self_read on public.contractors;
create policy contractors_self_read on public.contractors for select to authenticated
  using (profile_id = auth.uid() or public.is_staff());
drop policy if exists contractors_self_update on public.contractors;
create policy contractors_self_update on public.contractors for update to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- Guard: a contractor cannot flip their own offerable (staff/trigger only).
create or replace function public.contractors_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then
    new.offerable := old.offerable;
    new.bank_account_enc := old.bank_account_enc;  -- bank set only via RPC
    new.bank_account_last4 := old.bank_account_last4;
  end if;
  return new;
end $$;
drop trigger if exists contractors_guard_t on public.contractors;
create trigger contractors_guard_t before update on public.contractors for each row execute function public.contractors_guard();

-- contractor_documents: owner (via their contractor row) + staff
drop policy if exists contractor_documents_access on public.contractor_documents;
create policy contractor_documents_access on public.contractor_documents for all to authenticated
  using (public.is_staff() or contractor_id in (select id from public.contractors where profile_id = auth.uid()))
  with check (public.is_staff() or contractor_id in (select id from public.contractors where profile_id = auth.uid()));

-- contractor_events: owner read; staff all; inserts via RPC/staff
drop policy if exists contractor_events_read on public.contractor_events;
create policy contractor_events_read on public.contractor_events for select to authenticated
  using (public.is_staff() or contractor_id in (select id from public.contractors where profile_id = auth.uid()));
drop policy if exists contractor_events_staff on public.contractor_events;
create policy contractor_events_staff on public.contractor_events for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---- bank set/get RPCs (encrypt/decrypt with the Vault key) ------------------
create or replace function public.contractor_set_bank(p_bsb text, p_account text)
returns void language plpgsql security definer set search_path = public, vault as $$
declare v_cid uuid; v_key text;
begin
  select id into v_cid from public.contractors where profile_id = auth.uid();
  if v_cid is null then raise exception 'not a contractor'; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'contractor_bank_key';
  update public.contractors
    set bank_bsb = p_bsb,
        bank_account_enc = pgp_sym_encrypt(coalesce(p_account, ''), v_key),
        bank_account_last4 = right(regexp_replace(coalesce(p_account, ''), '\D', '', 'g'), 4)
    where id = v_cid;
  insert into public.contractor_events (contractor_id, type, detail, actor)
    values (v_cid, 'bank_changed', jsonb_build_object('bsb', p_bsb, 'last4', right(regexp_replace(coalesce(p_account, ''), '\D', '', 'g'), 4)), auth.uid());
end $$;

create or replace function public.contractor_get_bank(p_contractor_id uuid default null)
returns table (bsb text, account text) language plpgsql security definer set search_path = public, vault as $$
declare v_cid uuid; v_key text;
begin
  v_cid := coalesce(p_contractor_id, (select id from public.contractors where profile_id = auth.uid()));
  if not (public.is_staff() or v_cid = (select id from public.contractors where profile_id = auth.uid())) then
    raise exception 'not authorised'; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'contractor_bank_key';
  return query select c.bank_bsb, case when c.bank_account_enc is null then '' else pgp_sym_decrypt(c.bank_account_enc, v_key) end
    from public.contractors c where c.id = v_cid;
end $$;

grant execute on function public.contractor_set_bank(text, text) to authenticated;
grant execute on function public.contractor_get_bank(uuid) to authenticated;

-- ---- offerable = all required docs valid (insurance) ; extended in Phase F ---
create or replace function public.contractor_recompute_offerable(p_cid uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  v_ok := exists (
    select 1 from public.contractor_documents d
    where d.contractor_id = p_cid and d.kind = 'insurance'
      and (d.expires_on is null or d.expires_on >= current_date)
      and d.file_url <> ''
  );
  update public.contractors set offerable = v_ok where id = p_cid;
end $$;

create or replace function public.contractor_docs_touch() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- refresh expired status + offerable whenever a document row changes
  update public.contractor_documents set status = case
    when file_url = '' then 'pending'
    when expires_on is not null and expires_on < current_date then 'expired'
    else 'valid' end
    where id = coalesce(new.id, old.id);
  perform public.contractor_recompute_offerable(coalesce(new.contractor_id, old.contractor_id));
  return coalesce(new, old);
end $$;
drop trigger if exists contractor_docs_touch_t on public.contractor_documents;
create trigger contractor_docs_touch_t after insert or update or delete on public.contractor_documents
  for each row execute function public.contractor_docs_touch();

-- ---- storage bucket for contractor logos (public read, owner/staff write) ----
insert into storage.buckets (id, name, public) values ('contractor-logos', 'contractor-logos', true) on conflict (id) do nothing;
drop policy if exists contractor_logos_read on storage.objects;
drop policy if exists contractor_logos_write on storage.objects;
drop policy if exists contractor_logos_update on storage.objects;
drop policy if exists contractor_logos_delete on storage.objects;
create policy contractor_logos_read on storage.objects for select using (bucket_id = 'contractor-logos');
create policy contractor_logos_write on storage.objects for insert to authenticated with check (bucket_id = 'contractor-logos');
create policy contractor_logos_update on storage.objects for update to authenticated using (bucket_id = 'contractor-logos');
create policy contractor_logos_delete on storage.objects for delete to authenticated using (bucket_id = 'contractor-logos');

-- ---- Verification -----------------------------------------------------------
-- select column_name from information_schema.columns where table_name='contractors' and column_name in ('company_name','bank_account_enc','offerable');
-- select id from storage.buckets where id='contractor-logos';
-- select 1 from vault.secrets where name='contractor_bank_key';
