-- =============================================================================
-- Contacts — customers/companies that can be attached to an estimate.
-- Staff-only. Estimates reference a contact via builder_state (contact_id + a
-- snapshot for display).
-- =============================================================================

create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  first_name  text not null,
  last_name   text,
  company     text,
  email       text,
  phone       text,
  address     text,
  city        text,
  state       text,
  postal      text,
  notes       text,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index on public.contacts (last_name);
create index on public.contacts (company);

alter table public.contacts enable row level security;

create policy contacts_staff_all on public.contacts
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create trigger t_contacts_updated before update on public.contacts
  for each row execute function public.set_updated_at();
