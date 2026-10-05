-- Applied with execute_sql on 2026-10-05 (Task 9, second continuation): the rows of master-data.sql that a network
-- error had left out (timetable rows tt-copa-s2u1-d2-p1 .. tt-nsk-ele-s1u1-d6-p4, generator chunks 15 and 16 of 16) and
-- test-institute.sql, both rewritten to ON CONFLICT (id) DO NOTHING so the statements only insert. Same rows as the
-- generated files; the live fingerprints equal the generator's (see task-9-report.md).
insert into public.timetable (id,institute_id,batch_id,instructor_id,weekday,period_no,kind,window_start,window_end,subject_id) values
('tt-copa-s2u1-d2-p1','inst-27410','copa-s2u1','st-swati',2,1,'theory','14:00','15:00',null),
('tt-copa-s2u1-d2-p2','inst-27410','copa-s2u1','st-swati',2,2,'practical','15:00','17:00',null),
('tt-copa-s2u1-d2-p3','inst-27410','copa-s2u1','st-swati',2,3,'theory','17:00','18:00',null),
('tt-copa-s2u1-d2-p4','inst-27410','copa-s2u1','st-swati',2,4,'practical','18:00','20:00',null),
('tt-copa-s2u1-d3-p1','inst-27410','copa-s2u1','st-swati',3,1,'theory','14:00','15:00',null),
('tt-copa-s2u1-d3-p2','inst-27410','copa-s2u1','st-swati',3,2,'practical','15:00','17:00',null),
('tt-copa-s2u1-d3-p3','inst-27410','copa-s2u1','st-swati',3,3,'theory','17:00','18:00',null),
('tt-copa-s2u1-d3-p4','inst-27410','copa-s2u1','st-swati',3,4,'practical','18:00','20:00',null),
('tt-copa-s2u1-d4-p1','inst-27410','copa-s2u1','st-swati',4,1,'theory','14:00','15:00',null),
('tt-copa-s2u1-d4-p2','inst-27410','copa-s2u1','st-swati',4,2,'practical','15:00','17:00',null),
('tt-copa-s2u1-d4-p3','inst-27410','copa-s2u1','st-swati',4,3,'theory','17:00','18:00',null),
('tt-copa-s2u1-d4-p4','inst-27410','copa-s2u1','st-swati',4,4,'practical','18:00','20:00',null),
('tt-copa-s2u1-d5-p1','inst-27410','copa-s2u1','st-swati',5,1,'theory','14:00','15:00',null),
('tt-copa-s2u1-d5-p2','inst-27410','copa-s2u1','st-swati',5,2,'practical','15:00','17:00',null),
('tt-copa-s2u1-d5-p3','inst-27410','copa-s2u1','st-swati',5,3,'theory','17:00','18:00',null),
('tt-copa-s2u1-d5-p4','inst-27410','copa-s2u1','st-swati',5,4,'practical','18:00','20:00',null),
('tt-copa-s2u1-d6-p1','inst-27410','copa-s2u1','st-swati',6,1,'theory','14:00','15:00',null),
('tt-copa-s2u1-d6-p2','inst-27410','copa-s2u1','st-swati',6,2,'practical','15:00','17:00',null),
('tt-copa-s2u1-d6-p3','inst-27410','copa-s2u1','st-swati',6,3,'theory','17:00','18:00',null),
('tt-copa-s2u1-d6-p4','inst-27410','copa-s2u1','st-swati',6,4,'practical','18:00','20:00',null),
('tt-md-s1u1-d0-p1','inst-27410','md-s1u1','st-ganesh',0,1,'theory','07:00','08:00',null),
('tt-md-s1u1-d0-p2','inst-27410','md-s1u1','st-ganesh',0,2,'practical','08:00','10:00',null),
('tt-md-s1u1-d0-p3','inst-27410','md-s1u1','st-ganesh',0,3,'theory','10:00','11:00',null),
('tt-md-s1u1-d0-p4','inst-27410','md-s1u1','st-ganesh',0,4,'practical','11:00','13:00',null),
('tt-md-s1u1-d1-p1','inst-27410','md-s1u1','st-ganesh',1,1,'theory','07:00','08:00',null),
('tt-md-s1u1-d1-p2','inst-27410','md-s1u1','st-ganesh',1,2,'practical','08:00','10:00',null),
('tt-md-s1u1-d1-p3','inst-27410','md-s1u1','st-ganesh',1,3,'theory','10:00','11:00',null),
('tt-md-s1u1-d1-p4','inst-27410','md-s1u1','st-ganesh',1,4,'practical','11:00','13:00',null),
('tt-md-s1u1-d2-p1','inst-27410','md-s1u1','st-ganesh',2,1,'theory','07:00','08:00',null),
('tt-md-s1u1-d2-p2','inst-27410','md-s1u1','st-ganesh',2,2,'practical','08:00','10:00',null),
('tt-md-s1u1-d2-p3','inst-27410','md-s1u1','st-ganesh',2,3,'theory','10:00','11:00',null),
('tt-md-s1u1-d2-p4','inst-27410','md-s1u1','st-ganesh',2,4,'practical','11:00','13:00',null),
('tt-md-s1u1-d3-p1','inst-27410','md-s1u1','st-ganesh',3,1,'theory','07:00','08:00',null),
('tt-md-s1u1-d3-p2','inst-27410','md-s1u1','st-ganesh',3,2,'practical','08:00','10:00',null),
('tt-md-s1u1-d3-p3','inst-27410','md-s1u1','st-ganesh',3,3,'theory','10:00','11:00',null),
('tt-md-s1u1-d3-p4','inst-27410','md-s1u1','st-ganesh',3,4,'practical','11:00','13:00',null),
('tt-md-s1u1-d4-p1','inst-27410','md-s1u1','st-ganesh',4,1,'theory','07:00','08:00',null),
('tt-md-s1u1-d4-p2','inst-27410','md-s1u1','st-ganesh',4,2,'practical','08:00','10:00',null),
('tt-md-s1u1-d4-p3','inst-27410','md-s1u1','st-ganesh',4,3,'theory','10:00','11:00',null),
('tt-md-s1u1-d4-p4','inst-27410','md-s1u1','st-ganesh',4,4,'practical','11:00','13:00',null),
('tt-md-s1u1-d5-p1','inst-27410','md-s1u1','st-ganesh',5,1,'theory','07:00','08:00',null),
('tt-md-s1u1-d5-p2','inst-27410','md-s1u1','st-ganesh',5,2,'practical','08:00','10:00',null),
('tt-md-s1u1-d5-p3','inst-27410','md-s1u1','st-ganesh',5,3,'theory','10:00','11:00',null),
('tt-md-s1u1-d5-p4','inst-27410','md-s1u1','st-ganesh',5,4,'practical','11:00','13:00',null),
('tt-md-s1u1-d6-p1','inst-27410','md-s1u1','st-ganesh',6,1,'theory','07:00','08:00',null),
('tt-md-s1u1-d6-p2','inst-27410','md-s1u1','st-ganesh',6,2,'practical','08:00','10:00',null),
('tt-md-s1u1-d6-p3','inst-27410','md-s1u1','st-ganesh',6,3,'theory','10:00','11:00',null),
('tt-md-s1u1-d6-p4','inst-27410','md-s1u1','st-ganesh',6,4,'practical','11:00','13:00',null),
('tt-md-s2u1-d0-p1','inst-27410','md-s2u1','st-dattatray',0,1,'theory','14:00','15:00',null),
('tt-md-s2u1-d0-p2','inst-27410','md-s2u1','st-dattatray',0,2,'practical','15:00','17:00',null),
('tt-md-s2u1-d0-p3','inst-27410','md-s2u1','st-dattatray',0,3,'theory','17:00','18:00',null),
('tt-md-s2u1-d0-p4','inst-27410','md-s2u1','st-dattatray',0,4,'practical','18:00','20:00',null),
('tt-md-s2u1-d1-p1','inst-27410','md-s2u1','st-dattatray',1,1,'theory','14:00','15:00',null),
('tt-md-s2u1-d1-p2','inst-27410','md-s2u1','st-dattatray',1,2,'practical','15:00','17:00',null),
('tt-md-s2u1-d1-p3','inst-27410','md-s2u1','st-dattatray',1,3,'theory','17:00','18:00',null),
('tt-md-s2u1-d1-p4','inst-27410','md-s2u1','st-dattatray',1,4,'practical','18:00','20:00',null),
('tt-md-s2u1-d2-p1','inst-27410','md-s2u1','st-dattatray',2,1,'theory','14:00','15:00',null),
('tt-md-s2u1-d2-p2','inst-27410','md-s2u1','st-dattatray',2,2,'practical','15:00','17:00',null),
('tt-md-s2u1-d2-p3','inst-27410','md-s2u1','st-dattatray',2,3,'theory','17:00','18:00',null),
('tt-md-s2u1-d2-p4','inst-27410','md-s2u1','st-dattatray',2,4,'practical','18:00','20:00',null),
('tt-md-s2u1-d3-p1','inst-27410','md-s2u1','st-dattatray',3,1,'theory','14:00','15:00',null),
('tt-md-s2u1-d3-p2','inst-27410','md-s2u1','st-dattatray',3,2,'practical','15:00','17:00',null),
('tt-md-s2u1-d3-p3','inst-27410','md-s2u1','st-dattatray',3,3,'theory','17:00','18:00',null),
('tt-md-s2u1-d3-p4','inst-27410','md-s2u1','st-dattatray',3,4,'practical','18:00','20:00',null),
('tt-md-s2u1-d4-p1','inst-27410','md-s2u1','st-dattatray',4,1,'theory','14:00','15:00',null),
('tt-md-s2u1-d4-p2','inst-27410','md-s2u1','st-dattatray',4,2,'practical','15:00','17:00',null),
('tt-md-s2u1-d4-p3','inst-27410','md-s2u1','st-dattatray',4,3,'theory','17:00','18:00',null),
('tt-md-s2u1-d4-p4','inst-27410','md-s2u1','st-dattatray',4,4,'practical','18:00','20:00',null),
('tt-md-s2u1-d5-p1','inst-27410','md-s2u1','st-dattatray',5,1,'theory','14:00','15:00',null),
('tt-md-s2u1-d5-p2','inst-27410','md-s2u1','st-dattatray',5,2,'practical','15:00','17:00',null),
('tt-md-s2u1-d5-p3','inst-27410','md-s2u1','st-dattatray',5,3,'theory','17:00','18:00',null),
('tt-md-s2u1-d5-p4','inst-27410','md-s2u1','st-dattatray',5,4,'practical','18:00','20:00',null),
('tt-md-s2u1-d6-p1','inst-27410','md-s2u1','st-dattatray',6,1,'theory','14:00','15:00',null),
('tt-md-s2u1-d6-p2','inst-27410','md-s2u1','st-dattatray',6,2,'practical','15:00','17:00',null),
('tt-md-s2u1-d6-p3','inst-27410','md-s2u1','st-dattatray',6,3,'theory','17:00','18:00',null),
('tt-md-s2u1-d6-p4','inst-27410','md-s2u1','st-dattatray',6,4,'practical','18:00','20:00',null),
('tt-nsk-ele-s1u1-d0-p1','inst-27613','nsk-ele-s1u1','st-nsk-ravi',0,1,'theory','07:00','08:00',null),
('tt-nsk-ele-s1u1-d0-p2','inst-27613','nsk-ele-s1u1','st-nsk-ravi',0,2,'practical','08:00','10:00',null),
('tt-nsk-ele-s1u1-d0-p3','inst-27613','nsk-ele-s1u1','st-nsk-ravi',0,3,'theory','10:00','11:00',null),
('tt-nsk-ele-s1u1-d0-p4','inst-27613','nsk-ele-s1u1','st-nsk-ravi',0,4,'practical','11:00','13:00',null),
('tt-nsk-ele-s1u1-d1-p1','inst-27613','nsk-ele-s1u1','st-nsk-ravi',1,1,'theory','07:00','08:00',null),
('tt-nsk-ele-s1u1-d1-p2','inst-27613','nsk-ele-s1u1','st-nsk-ravi',1,2,'practical','08:00','10:00',null),
('tt-nsk-ele-s1u1-d1-p3','inst-27613','nsk-ele-s1u1','st-nsk-ravi',1,3,'theory','10:00','11:00',null),
('tt-nsk-ele-s1u1-d1-p4','inst-27613','nsk-ele-s1u1','st-nsk-ravi',1,4,'practical','11:00','13:00',null),
('tt-nsk-ele-s1u1-d2-p1','inst-27613','nsk-ele-s1u1','st-nsk-ravi',2,1,'theory','07:00','08:00',null),
('tt-nsk-ele-s1u1-d2-p2','inst-27613','nsk-ele-s1u1','st-nsk-ravi',2,2,'practical','08:00','10:00',null),
('tt-nsk-ele-s1u1-d2-p3','inst-27613','nsk-ele-s1u1','st-nsk-ravi',2,3,'theory','10:00','11:00',null),
('tt-nsk-ele-s1u1-d2-p4','inst-27613','nsk-ele-s1u1','st-nsk-ravi',2,4,'practical','11:00','13:00',null),
('tt-nsk-ele-s1u1-d3-p1','inst-27613','nsk-ele-s1u1','st-nsk-ravi',3,1,'theory','07:00','08:00',null),
('tt-nsk-ele-s1u1-d3-p2','inst-27613','nsk-ele-s1u1','st-nsk-ravi',3,2,'practical','08:00','10:00',null),
('tt-nsk-ele-s1u1-d3-p3','inst-27613','nsk-ele-s1u1','st-nsk-ravi',3,3,'theory','10:00','11:00',null),
('tt-nsk-ele-s1u1-d3-p4','inst-27613','nsk-ele-s1u1','st-nsk-ravi',3,4,'practical','11:00','13:00',null),
('tt-nsk-ele-s1u1-d4-p1','inst-27613','nsk-ele-s1u1','st-nsk-ravi',4,1,'theory','07:00','08:00',null),
('tt-nsk-ele-s1u1-d4-p2','inst-27613','nsk-ele-s1u1','st-nsk-ravi',4,2,'practical','08:00','10:00',null),
('tt-nsk-ele-s1u1-d4-p3','inst-27613','nsk-ele-s1u1','st-nsk-ravi',4,3,'theory','10:00','11:00',null),
('tt-nsk-ele-s1u1-d4-p4','inst-27613','nsk-ele-s1u1','st-nsk-ravi',4,4,'practical','11:00','13:00',null),
('tt-nsk-ele-s1u1-d5-p1','inst-27613','nsk-ele-s1u1','st-nsk-ravi',5,1,'theory','07:00','08:00',null),
('tt-nsk-ele-s1u1-d5-p2','inst-27613','nsk-ele-s1u1','st-nsk-ravi',5,2,'practical','08:00','10:00',null),
('tt-nsk-ele-s1u1-d5-p3','inst-27613','nsk-ele-s1u1','st-nsk-ravi',5,3,'theory','10:00','11:00',null),
('tt-nsk-ele-s1u1-d5-p4','inst-27613','nsk-ele-s1u1','st-nsk-ravi',5,4,'practical','11:00','13:00',null)
on conflict (id) do nothing;
insert into public.timetable (id,institute_id,batch_id,instructor_id,weekday,period_no,kind,window_start,window_end,subject_id) values
('tt-nsk-ele-s1u1-d6-p1','inst-27613','nsk-ele-s1u1','st-nsk-ravi',6,1,'theory','07:00','08:00',null),
('tt-nsk-ele-s1u1-d6-p2','inst-27613','nsk-ele-s1u1','st-nsk-ravi',6,2,'practical','08:00','10:00',null),
('tt-nsk-ele-s1u1-d6-p3','inst-27613','nsk-ele-s1u1','st-nsk-ravi',6,3,'theory','10:00','11:00',null),
('tt-nsk-ele-s1u1-d6-p4','inst-27613','nsk-ele-s1u1','st-nsk-ravi',6,4,'practical','11:00','13:00',null)
on conflict (id) do nothing;
insert into public.institutes (id,code,name,short_name,district,locality,location,shift_windows) values
('inst-99999','99999','Test Industrial Training Institute (live smoke test)','Test ITI','Test District','Test','{"lat":18.52,"lng":73.8567}'::jsonb,null)
on conflict (id) do nothing;
insert into public.trades (id,institute_id,name,duration_years) values
('tst','inst-99999','Test Trade',1)
on conflict (id) do nothing;
insert into public.batches (id,institute_id,trade_id,shift,unit,year) values
('tst-s1u1','inst-99999','tst',1,1,1)
on conflict (id) do nothing;
insert into public.students (id,institute_id,batch_id,roll_no,name,father_name) values
('tst-s1u1-r01','inst-99999','tst-s1u1',1,'Test Student One','Test Father One'),
('tst-s1u1-r02','inst-99999','tst-s1u1',2,'Test Student Two','Test Father Two'),
('tst-s1u1-r03','inst-99999','tst-s1u1',3,'Test Student Three','Test Father Three')
on conflict (id) do nothing;
insert into public.staff (id,institute_id,trainer_id,name,role,employment_type,designation,primary_trade_id,secondary_trade_ids,batch_ids,subject_id,multi_trade_allowed) values
('st-tst','inst-99999','TR-99001','Test Instructor','instructor','regular','Craft Instructor','tst','{}'::text[],array['tst-s1u1']::text[],null,false)
on conflict (id) do nothing;
