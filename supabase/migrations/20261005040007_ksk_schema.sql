-- KSK Attendance (Task 9): tables mirroring src/domain/{entities,attendance,announcement,device}.ts.
-- Text ids equal the app's ids. institute_id sits on every institute-owned row (subjects are shared).
-- Client-only state is not stored: syncState (a server row is synced by definition), drafts, the offline queue,
-- packs, verification passes, the session and preferences stay on the device (D-143).
-- Timestamps are timestamptz (the app sends ISO strings); LocalDate is date; LocalTime is 'HH:MM' text.

-- ---------- Master data (written only by the seed; read by everyone) ----------

create table public.institutes (
  id text primary key,
  code text not null unique,
  name text not null,
  short_name text not null,
  district text not null,
  locality text not null,
  location jsonb not null check (jsonb_typeof(location->'lat') = 'number' and jsonb_typeof(location->'lng') = 'number'),
  shift_windows jsonb check (shift_windows is null or jsonb_typeof(shift_windows) = 'object')
);

create table public.subjects (
  id text primary key,
  name text not null
);

create table public.trades (
  id text primary key,
  institute_id text not null references public.institutes(id),
  name text not null,
  duration_years smallint not null check (duration_years in (1, 2))
);
create index trades_institute_id_idx on public.trades (institute_id);

create table public.batches (
  id text primary key,
  institute_id text not null references public.institutes(id),
  trade_id text not null references public.trades(id),
  shift smallint not null check (shift in (1, 2)),
  unit integer not null check (unit > 0),
  year smallint not null check (year in (1, 2))
);
create index batches_institute_id_idx on public.batches (institute_id);
create index batches_trade_id_idx on public.batches (trade_id);

create table public.students (
  id text primary key,
  institute_id text not null references public.institutes(id),
  batch_id text not null references public.batches(id),
  roll_no integer not null check (roll_no > 0),
  name text not null,
  father_name text not null,
  unique (batch_id, roll_no)
);
create index students_institute_id_idx on public.students (institute_id);

create table public.staff (
  id text primary key,
  institute_id text not null references public.institutes(id),
  trainer_id text not null,
  name text not null,
  role text not null check (role in ('instructor', 'group_instructor', 'principal', 'office_staff')),
  employment_type text not null check (employment_type in ('regular', 'contractual', 'guest')),
  designation text not null,
  primary_trade_id text references public.trades(id),
  secondary_trade_ids text[] not null default '{}',
  batch_ids text[] not null default '{}',
  subject_id text references public.subjects(id),
  multi_trade_allowed boolean not null default false,
  unique (institute_id, trainer_id)
);
create index staff_primary_trade_id_idx on public.staff (primary_trade_id);
create index staff_subject_id_idx on public.staff (subject_id);

create table public.timetable (
  id text primary key,
  institute_id text not null references public.institutes(id),
  batch_id text not null references public.batches(id),
  instructor_id text not null references public.staff(id),
  weekday smallint not null check (weekday between 0 and 6),
  period_no integer not null check (period_no > 0),
  kind text not null check (kind in ('theory', 'practical')),
  window_start text not null check (window_start ~ '^\d{2}:\d{2}$'),
  window_end text not null check (window_end ~ '^\d{2}:\d{2}$'),
  subject_id text references public.subjects(id)
);
create index timetable_institute_id_idx on public.timetable (institute_id);
create index timetable_batch_id_idx on public.timetable (batch_id);
create index timetable_instructor_id_idx on public.timetable (instructor_id);
create index timetable_subject_id_idx on public.timetable (subject_id);

-- ---------- Dated reference rows (seeded per day relative to today; updated in place) ----------

create table public.ojt (
  id text primary key,
  institute_id text not null references public.institutes(id),
  student_ids text[] not null,
  from_date date not null,
  to_date date not null,
  check (from_date <= to_date)
);
create index ojt_institute_id_idx on public.ojt (institute_id);

create table public.announcements (
  id text primary key,
  institute_id text not null references public.institutes(id),
  category text not null check (category in ('info', 'important', 'holiday', 'ojt')),
  priority text not null check (priority in ('high', 'normal')),
  source text not null check (source in ('state', 'institute', 'principal')),
  audience jsonb not null check (audience->>'kind' in ('institute', 'trade', 'batch', 'staff')),
  title jsonb not null check (jsonb_typeof(title->'en') = 'string'),
  body jsonb not null check (jsonb_typeof(body->'en') = 'string'),
  published_at timestamptz not null,
  show_from date not null,
  show_until date not null,
  event_from date,
  event_to date
);
create index announcements_institute_id_idx on public.announcements (institute_id);

-- ---------- Operational records (write-once; corrections append-only) ----------

create table public.submissions (
  id text primary key,
  session_key text not null unique,
  institute_id text not null references public.institutes(id),
  batch_id text not null references public.batches(id),
  date date not null,
  slot jsonb not null check (slot->>'kind' in ('daily', 'half', 'period')),
  subject_id text references public.subjects(id),
  marks jsonb not null check (jsonb_typeof(marks) = 'object'),
  marked_by text not null references public.staff(id),
  device_timestamp timestamptz not null,
  server_timestamp timestamptz not null default now(),
  location jsonb check (location is null or jsonb_typeof(location) = 'object'),
  origin text not null default 'app' check (origin in ('app', 'seed'))
);
create index submissions_batch_id_date_idx on public.submissions (batch_id, date);
create index submissions_institute_id_date_idx on public.submissions (institute_id, date);
create index submissions_marked_by_idx on public.submissions (marked_by);
create index submissions_subject_id_idx on public.submissions (subject_id);

create table public.corrections (
  correction_id text primary key,
  attendance_id text not null references public.submissions(id),
  institute_id text not null references public.institutes(id),
  student_id text not null references public.students(id),
  old_mark jsonb not null check (jsonb_typeof(old_mark) = 'object'),
  new_mark jsonb not null check (jsonb_typeof(new_mark) = 'object'),
  reason text not null check (length(reason) > 0),
  reason_code text check (reason_code in ('late', 'mistake', 'duty')),
  actor_id text not null references public.staff(id),
  "timestamp" timestamptz not null
);
create index corrections_attendance_id_idx on public.corrections (attendance_id);
create index corrections_institute_id_idx on public.corrections (institute_id);
create index corrections_student_id_idx on public.corrections (student_id);
create index corrections_actor_id_idx on public.corrections (actor_id);

create table public.staff_attendance (
  id text primary key,
  institute_id text not null references public.institutes(id),
  staff_id text not null references public.staff(id),
  date date not null,
  status text not null check (status in ('present', 'absent', 'half_day', 'leave', 'ojt')),
  source text not null check (source in ('self', 'principal')),
  marked_by text not null references public.staff(id),
  device_timestamp timestamptz not null,
  location jsonb check (location is null or jsonb_typeof(location) = 'object'),
  unique (staff_id, date)
);
create index staff_attendance_date_idx on public.staff_attendance (date);
create index staff_attendance_institute_id_date_idx on public.staff_attendance (institute_id, date);
create index staff_attendance_marked_by_idx on public.staff_attendance (marked_by);

create table public.voice_usage (
  staff_id text not null references public.staff(id),
  date date not null,
  institute_id text not null references public.institutes(id),
  seconds double precision not null default 0 check (seconds >= 0),
  primary key (staff_id, date)
);
create index voice_usage_institute_id_idx on public.voice_usage (institute_id);

-- SIMULATION ONLY: records that enrolment happened, never an image or template (D-048).
create table public.face_enrolment (
  staff_id text primary key references public.staff(id),
  institute_id text not null references public.institutes(id),
  enrolled_at timestamptz not null,
  sample_count integer not null check (sample_count >= 0),
  simulated boolean not null default true check (simulated)
);
create index face_enrolment_institute_id_idx on public.face_enrolment (institute_id);

create table public.demo_meta (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

-- ---------- Triggers: the server, not the client, decides institute_id and the server time ----------

create function public.ksk_fill_institute() returns trigger
language plpgsql set search_path = '' as $$
begin
  case tg_table_name
    when 'submissions' then select b.institute_id into new.institute_id from public.batches b where b.id = new.batch_id;
    when 'corrections' then select s.institute_id into new.institute_id from public.submissions s where s.id = new.attendance_id;
    when 'staff_attendance', 'voice_usage', 'face_enrolment' then
      select st.institute_id into new.institute_id from public.staff st where st.id = new.staff_id;
    when 'ojt' then select s.institute_id into new.institute_id from public.students s where s.id = new.student_ids[1];
  end case;
  if new.institute_id is null then
    raise exception 'ksk: % row % points at a missing parent', tg_table_name, to_jsonb(new)->>(case tg_table_name when 'corrections' then 'correction_id' when 'voice_usage' then 'staff_id' when 'face_enrolment' then 'staff_id' else 'id' end)
      using errcode = 'foreign_key_violation';
  end if;
  return new;
end $$;

create trigger submissions_fill_institute before insert on public.submissions for each row execute function public.ksk_fill_institute();
create trigger corrections_fill_institute before insert on public.corrections for each row execute function public.ksk_fill_institute();
create trigger staff_attendance_fill_institute before insert on public.staff_attendance for each row execute function public.ksk_fill_institute();
create trigger voice_usage_fill_institute before insert on public.voice_usage for each row execute function public.ksk_fill_institute();
create trigger face_enrolment_fill_institute before insert on public.face_enrolment for each row execute function public.ksk_fill_institute();
create trigger ojt_fill_institute before insert or update on public.ojt for each row execute function public.ksk_fill_institute();

-- A record from the app gets the server's clock; seeded history keeps the time it was generated with.
create function public.ksk_stamp_server_time() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.origin = 'app' or new.server_timestamp is null then
    new.server_timestamp := now();
  end if;
  return new;
end $$;

create trigger submissions_stamp_server_time before insert on public.submissions for each row execute function public.ksk_stamp_server_time();

-- Trigger functions are not API endpoints.
revoke execute on function public.ksk_fill_institute(), public.ksk_stamp_server_time() from public, anon, authenticated;

-- ---------- Row Level Security (D-144: permissive demo policies, documented) ----------
-- The app has no real identity yet (institute code + trainer ID), so the anon role reads everything and inserts
-- write-once records; unique keys enforce write-once and corrections are insert-only. Seeding and reset go through
-- SECURITY DEFINER functions. Production needs SwiftChat-signed identity mapped to Supabase auth.

alter table public.institutes enable row level security;
alter table public.subjects enable row level security;
alter table public.trades enable row level security;
alter table public.batches enable row level security;
alter table public.students enable row level security;
alter table public.staff enable row level security;
alter table public.timetable enable row level security;
alter table public.ojt enable row level security;
alter table public.announcements enable row level security;
alter table public.submissions enable row level security;
alter table public.corrections enable row level security;
alter table public.staff_attendance enable row level security;
alter table public.voice_usage enable row level security;
alter table public.face_enrolment enable row level security;
alter table public.demo_meta enable row level security;

-- Grants match the policies exactly (no TRUNCATE, REFERENCES or TRIGGER for the API roles).
revoke all on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to anon;
grant insert on public.submissions, public.corrections, public.staff_attendance, public.voice_usage, public.face_enrolment to anon;
grant update on public.voice_usage to anon;
grant delete on public.face_enrolment to anon;

create policy "demo: anon reads institutes" on public.institutes for select to anon using (true);
create policy "demo: anon reads subjects" on public.subjects for select to anon using (true);
create policy "demo: anon reads trades" on public.trades for select to anon using (true);
create policy "demo: anon reads batches" on public.batches for select to anon using (true);
create policy "demo: anon reads students" on public.students for select to anon using (true);
create policy "demo: anon reads staff" on public.staff for select to anon using (true);
create policy "demo: anon reads timetable" on public.timetable for select to anon using (true);
create policy "demo: anon reads ojt" on public.ojt for select to anon using (true);
create policy "demo: anon reads announcements" on public.announcements for select to anon using (true);
create policy "demo: anon reads submissions" on public.submissions for select to anon using (true);
create policy "demo: anon reads corrections" on public.corrections for select to anon using (true);
create policy "demo: anon reads staff_attendance" on public.staff_attendance for select to anon using (true);
create policy "demo: anon reads voice_usage" on public.voice_usage for select to anon using (true);
create policy "demo: anon reads face_enrolment" on public.face_enrolment for select to anon using (true);
create policy "demo: anon reads demo_meta" on public.demo_meta for select to anon using (true);

-- Seeded rows come only from ksk_seed_day.
create policy "demo: anon submits attendance" on public.submissions for insert to anon with check (origin = 'app');
create policy "demo: anon appends corrections" on public.corrections for insert to anon with check (true);
create policy "demo: anon marks staff attendance" on public.staff_attendance for insert to anon with check (true);
create policy "demo: anon records voice usage" on public.voice_usage for insert to anon with check (true);
create policy "demo: anon updates voice usage" on public.voice_usage for update to anon using (true) with check (true);
create policy "demo: anon enrols a face" on public.face_enrolment for insert to anon with check (simulated);
create policy "demo: anon removes a face enrolment" on public.face_enrolment for delete to anon using (true);
