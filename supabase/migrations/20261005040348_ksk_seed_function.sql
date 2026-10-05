-- KSK Attendance (Task 9): demo seeding (D-144). SECURITY DEFINER with a fixed search_path; anon may execute it
-- because the demo has no real identity yet. Idempotent: write-once records ON CONFLICT DO NOTHING; dated
-- reference rows (ojt, announcements) are updated in place. Sets demo_meta.seeded_day. Returns rows written per table.
create function public.ksk_seed_day(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  seed_day date := (payload->>'day')::date;
  n_submissions integer;
  n_corrections integer;
  n_staff integer;
  n_ojt integer;
  n_announcements integer;
  n_faces integer;
begin
  if seed_day is null then
    raise exception 'ksk_seed_day: payload.day (YYYY-MM-DD) is required' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.submissions (id, session_key, batch_id, date, slot, subject_id, marks, marked_by, device_timestamp, server_timestamp, location, origin)
  select r.id, r.session_key, r.batch_id, r.date, r.slot, r.subject_id, r.marks, r.marked_by, r.device_timestamp,
         coalesce(r.server_timestamp, r.device_timestamp), r.location, 'seed'
  from jsonb_populate_recordset(null::public.submissions, coalesce(payload->'submissions', '[]'::jsonb)) r
  on conflict do nothing;
  get diagnostics n_submissions = row_count;

  insert into public.corrections (correction_id, attendance_id, student_id, old_mark, new_mark, reason, reason_code, actor_id, "timestamp")
  select r.correction_id, r.attendance_id, r.student_id, r.old_mark, r.new_mark, r.reason, r.reason_code, r.actor_id, r."timestamp"
  from jsonb_populate_recordset(null::public.corrections, coalesce(payload->'corrections', '[]'::jsonb)) r
  on conflict do nothing;
  get diagnostics n_corrections = row_count;

  insert into public.staff_attendance (id, staff_id, date, status, source, marked_by, device_timestamp, location)
  select r.id, r.staff_id, r.date, r.status, r.source, r.marked_by, r.device_timestamp, r.location
  from jsonb_populate_recordset(null::public.staff_attendance, coalesce(payload->'staff_attendance', '[]'::jsonb)) r
  on conflict do nothing;
  get diagnostics n_staff = row_count;

  insert into public.ojt (id, student_ids, from_date, to_date)
  select r.id, r.student_ids, r.from_date, r.to_date
  from jsonb_populate_recordset(null::public.ojt, coalesce(payload->'ojt', '[]'::jsonb)) r
  on conflict (id) do update set student_ids = excluded.student_ids, from_date = excluded.from_date, to_date = excluded.to_date;
  get diagnostics n_ojt = row_count;

  insert into public.announcements (id, institute_id, category, priority, source, audience, title, body, published_at, show_from, show_until, event_from, event_to)
  select r.id, r.institute_id, r.category, r.priority, r.source, r.audience, r.title, r.body, r.published_at, r.show_from, r.show_until, r.event_from, r.event_to
  from jsonb_populate_recordset(null::public.announcements, coalesce(payload->'announcements', '[]'::jsonb)) r
  on conflict (id) do update set
    institute_id = excluded.institute_id, category = excluded.category, priority = excluded.priority, source = excluded.source,
    audience = excluded.audience, title = excluded.title, body = excluded.body, published_at = excluded.published_at,
    show_from = excluded.show_from, show_until = excluded.show_until, event_from = excluded.event_from, event_to = excluded.event_to;
  get diagnostics n_announcements = row_count;

  insert into public.face_enrolment (staff_id, enrolled_at, sample_count, simulated)
  select r.staff_id, r.enrolled_at, r.sample_count, true
  from jsonb_populate_recordset(null::public.face_enrolment, coalesce(payload->'face_enrolment', '[]'::jsonb)) r
  on conflict do nothing;
  get diagnostics n_faces = row_count;

  insert into public.demo_meta (key, value, updated_at) values ('seeded_day', seed_day::text, now())
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at;

  return jsonb_build_object(
    'day', seed_day, 'submissions', n_submissions, 'corrections', n_corrections, 'staff_attendance', n_staff,
    'ojt', n_ojt, 'announcements', n_announcements, 'face_enrolment', n_faces
  );
end $$;

revoke execute on function public.ksk_seed_day(jsonb) from public, authenticated;
grant execute on function public.ksk_seed_day(jsonb) to anon;
