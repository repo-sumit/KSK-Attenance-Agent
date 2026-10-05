-- Row counts per table and institute (expected after the master seed: Pune 27410 has 5 trades, 17 batches,
-- 417 students, 18 staff; Nashik 27613 has 1 trade, 1 batch, 20 students, 2 staff; test institute 99999 has
-- 1 trade, 1 batch, 3 students, 1 staff; 1 subject; 504 timetable rows for the two demo institutes).
select i.code,
  (select count(*) from public.trades t where t.institute_id = i.id) as trades,
  (select count(*) from public.batches b where b.institute_id = i.id) as batches,
  (select count(*) from public.students s where s.institute_id = i.id) as students,
  (select count(*) from public.staff st where st.institute_id = i.id) as staff,
  (select count(*) from public.timetable tt where tt.institute_id = i.id) as timetable,
  (select count(*) from public.subjects) as subjects
from public.institutes i order by i.code;
