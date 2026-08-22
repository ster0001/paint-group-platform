-- =====================================================================
-- Booking notes — the chase log on a job nobody has been booked into yet.
--
-- A job the customer accepted sits in the Unscheduled tray until a
-- contractor is booked. That gap is worked by PHONE — "left a voicemail",
-- "spoke to her, coming back Monday with dates" — and none of it was
-- recorded anywhere, so a second person picking the job up had no idea it
-- had been chased three times already.
--
-- A LOG, not a field. The point is the history: how many times we have
-- tried and how long they have been sitting on it. Overwriting one note
-- with the next would lose exactly the thing that tells you to stop
-- ringing and start reoffering.
--
-- STAFF ONLY, and that is the whole reason this is not `wo_events`.
-- wo_events carries a customer read policy (wo_events_customer), so a note
-- saying "chased again, still ignoring us" would be readable by the very
-- customer it is about. Nothing here is ever exposed to a customer or a
-- contractor: there is no policy for either, and RLS denies by default.
-- =====================================================================

create table if not exists public.wo_booking_notes (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders (id) on delete cascade,
  note          text not null,
  author        uuid references auth.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  -- An empty note is a mis-click, not a record. Length capped so the column
  -- can't be used as a dumping ground for pasted email threads.
  constraint wo_booking_notes_note_len check (char_length(btrim(note)) between 1 and 2000)
);

-- Read pattern is always "the notes on this job, newest first".
create index if not exists wo_booking_notes_wo_idx
  on public.wo_booking_notes (work_order_id, created_at desc);

alter table public.wo_booking_notes enable row level security;

-- Staff only. No contractor policy and no customer policy, deliberately —
-- with RLS on, absence of a policy is a denial.
drop policy if exists wo_booking_notes_staff on public.wo_booking_notes;
create policy wo_booking_notes_staff on public.wo_booking_notes
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- RLS permits; the table GRANT is what actually lets the row through. Both are
-- needed — wo_events has the staff policy but no insert grant, which is why a
-- direct insert there fails with "permission denied for table".
grant select, insert, delete on public.wo_booking_notes to authenticated;
revoke all on public.wo_booking_notes from anon;

-- Verification:
--   insert into wo_booking_notes (work_order_id, note)
--     values ('<a work order id>', 'left a voicemail');     -> 1 row, as staff
--   select note, created_at from wo_booking_notes order by created_at desc;
--   -- as a contractor or customer session:
--   select count(*) from wo_booking_notes;                  -> 0 (RLS denies)
