-- =============================================================================
-- Staff notifications (Tom, 10 Sep 2026)
--
-- "Which staff member sees each of these": contract accepted, job accepted /
-- declined by the painter, invoice paid, variation raised, contractor
-- invoice submitted. Each is an automation (lib/automations/registry.ts,
-- audience "office") with the usual on/off switch; WHO receives it, and by
-- which channel, lives on the person — profiles.staff_notify, a sibling of
-- staff_access: { eventKey: ["email", "sms"] }. A missing key = not sent to
-- that person. Text needs profiles.phone, new here.
--
-- staff_notifications is the once-only guard: one row per (event, entity),
-- claimed BEFORE any send, so a re-fired hook (the painter's browser pinging
-- twice, the Stripe webhook redelivering) never doubles a text.
-- =============================================================================

alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists staff_notify jsonb not null default '{}'::jsonb
  constraint profiles_staff_notify_object check (jsonb_typeof(staff_notify) = 'object');

comment on column public.profiles.phone is 'A staff member''s mobile, for staff text alerts (Settings → Staff logins).';
comment on column public.profiles.staff_notify is 'Staff alerts this person gets: { eventKey: ["email","sms"] }. Missing key = not sent (lib/staff/notifyEvents.ts).';

-- The owner guard (20270106) covers who-is-master and what-they-see; the
-- notify map is the person's own to change — owner or self, never a third
-- staff login over REST.
create or replace function public.profiles_guard_notify_fields()
returns trigger language plpgsql as $$
begin
  if (new.staff_notify is distinct from old.staff_notify or new.phone is distinct from old.phone)
     and auth.uid() is not null and auth.uid() <> new.id and not public.is_owner() then
    raise exception 'only the master user or the person themselves can change staff alerts' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists t_profiles_guard_notify on public.profiles;
create trigger t_profiles_guard_notify before update on public.profiles
  for each row execute function public.profiles_guard_notify_fields();

create table if not exists public.staff_notifications (
  id          uuid primary key default gen_random_uuid(),
  event_key   text not null,
  entity_id   text not null,
  recipients  jsonb not null default '[]'::jsonb,   -- [{ profile_id, channel, status }]
  created_at  timestamptz not null default now(),
  unique (event_key, entity_id)
);
comment on table public.staff_notifications is 'One row per staff alert actually fired (event × entity) — the once-only guard and the audit of who was told.';

alter table public.staff_notifications enable row level security;
drop policy if exists staff_notifications_staff_read on public.staff_notifications;
create policy staff_notifications_staff_read on public.staff_notifications
  for select using (public.is_staff());
-- Writes: service client only (the server hooks).

-- ---- read-back ----------------------------------------------------------------
do $$
begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
        and column_name in ('phone', 'staff_notify')) <> 2 then
    raise exception 'read-back: profiles.phone / staff_notify missing';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'staff_notifications') then
    raise exception 'read-back: staff_notifications missing';
  end if;
end $$;

-- Paste the result in chat: expect 2 rows (phone, staff_notify).
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles' and column_name in ('phone', 'staff_notify') order by 1;
