-- KSK Attendance (Task 9): other devices refresh when these change (D-143).
alter publication supabase_realtime add table public.submissions, public.corrections, public.staff_attendance, public.face_enrolment;
