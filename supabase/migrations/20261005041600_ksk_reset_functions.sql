-- KSK Attendance: demo reset and test clean-up (D-144). NOT APPLIED BY THE AGENTS: the Supabase MCP declines any
-- statement containing DELETE without an interactive confirmation. The owner pastes this file into the Supabase
-- dashboard (SQL editor); both functions use `create or replace`, so running it again is harmless.
-- Until it is applied, the app treats the two functions as missing (PostgREST PGRST202 / HTTP 404), which is an
-- expected answer, never an error: the demo panel's "Reset shared demo data" says "Reset isn't set up on the server
-- yet" and changes nothing, and `npm run test:supabase-live` skips its clean-up step, leaving that run's rows on the
-- test institute 99999.

-- "Reset shared demo data" (demo panel): deletes the operational rows of the demo institutes (every institute except
-- the live smoke-test one, code 99999) and all demo_meta; master data, OJT and announcements stay. The app then calls
-- ksk_seed_day with a full payload (45 days of history, today's story, yesterday's correction, OJT, notices, face
-- flags) and starts the presenter's device afresh; other devices read the fresh rows (Realtime). Returns the rows deleted
-- per table.
create or replace function public.ksk_reset_demo() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  demo text[] := array(select i.id from public.institutes i where i.code <> '99999');
  n_corrections integer;
  n_submissions integer;
  n_staff integer;
  n_voice integer;
  n_faces integer;
  n_meta integer;
begin
  delete from public.corrections where institute_id = any(demo);
  get diagnostics n_corrections = row_count;
  delete from public.submissions where institute_id = any(demo);
  get diagnostics n_submissions = row_count;
  delete from public.staff_attendance where institute_id = any(demo);
  get diagnostics n_staff = row_count;
  delete from public.voice_usage where institute_id = any(demo);
  get diagnostics n_voice = row_count;
  delete from public.face_enrolment where institute_id = any(demo);
  get diagnostics n_faces = row_count;
  delete from public.demo_meta where true;
  get diagnostics n_meta = row_count;
  return jsonb_build_object(
    'corrections', n_corrections, 'submissions', n_submissions, 'staff_attendance', n_staff,
    'voice_usage', n_voice, 'face_enrolment', n_faces, 'demo_meta', n_meta
  );
end $$;

-- The last step of `npm run test:supabase-live`: deletes the operational rows of the live smoke-test institute only
-- (code 99999). Returns the rows deleted per table.
create or replace function public.ksk_cleanup_test_institute() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  test_ids text[] := array(select i.id from public.institutes i where i.code = '99999');
  n_corrections integer;
  n_submissions integer;
  n_staff integer;
  n_voice integer;
  n_faces integer;
begin
  delete from public.corrections where institute_id = any(test_ids);
  get diagnostics n_corrections = row_count;
  delete from public.submissions where institute_id = any(test_ids);
  get diagnostics n_submissions = row_count;
  delete from public.staff_attendance where institute_id = any(test_ids);
  get diagnostics n_staff = row_count;
  delete from public.voice_usage where institute_id = any(test_ids);
  get diagnostics n_voice = row_count;
  delete from public.face_enrolment where institute_id = any(test_ids);
  get diagnostics n_faces = row_count;
  return jsonb_build_object(
    'corrections', n_corrections, 'submissions', n_submissions, 'staff_attendance', n_staff,
    'voice_usage', n_voice, 'face_enrolment', n_faces
  );
end $$;

revoke execute on function public.ksk_reset_demo(), public.ksk_cleanup_test_institute() from public, authenticated;
grant execute on function public.ksk_reset_demo(), public.ksk_cleanup_test_institute() to anon;
