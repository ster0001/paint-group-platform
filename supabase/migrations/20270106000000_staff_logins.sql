-- =============================================================================
-- Staff logins + per-person areas (Tom, 5 Sep 2026)
--
-- Settings → Company → Staff logins: the master user (profiles.is_owner)
-- creates office logins and ticks which areas of the staff app each one
-- sees. profiles.staff_access is { areaKey: false } for hidden areas; a
-- missing key = visible (lib/staff/access.ts). Owners ignore the map.
--
-- Who may change these two columns: the service client (the server action,
-- auth.uid() is null) or an owner. Any other staff login updating them —
-- the existing profiles_staff_all policy lets staff update every profile —
-- is refused by the trigger, so nobody promotes themselves over REST.
--
-- Bootstrap: while NO owner exists, any staff login may create the first
-- one through the tool (the server action checks that). Idempotent.
-- =============================================================================

alter table public.profiles add column if not exists is_owner boolean not null default false;
alter table public.profiles add column if not exists staff_access jsonb not null default '{}'::jsonb
  constraint profiles_staff_access_object check (jsonb_typeof(staff_access) = 'object');

comment on column public.profiles.is_owner is 'The master staff user: manages staff logins and sees every area. Set only by the server action / an owner.';
comment on column public.profiles.staff_access is 'Per-area visibility for a staff login: { areaKey: false } hides; missing = visible. Owners ignore it.';

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'staff' and is_owner)
$$;

create or replace function public.profiles_guard_owner_fields()
returns trigger language plpgsql as $$
begin
  if (new.is_owner is distinct from old.is_owner or new.staff_access is distinct from old.staff_access)
     and auth.uid() is not null and not public.is_owner() then
    raise exception 'only the master user can change who is master or what a staff login sees' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists t_profiles_guard_owner on public.profiles;
create trigger t_profiles_guard_owner before update on public.profiles
  for each row execute function public.profiles_guard_owner_fields();

-- ---- read-back ----------------------------------------------------------------
do $$
begin
  if (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
        and column_name in ('is_owner', 'staff_access')) <> 2 then
    raise exception 'read-back: profiles.is_owner / staff_access missing';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 't_profiles_guard_owner') then
    raise exception 'read-back: t_profiles_guard_owner missing';
  end if;
end $$;

-- Paste the result in chat: expect 2 rows (is_owner, staff_access).
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'profiles' and column_name in ('is_owner', 'staff_access') order by 1;
