import { describe, expect, it } from 'vitest';
import { buildAnnouncements } from '@/data/mock/announcements';
import { buildMasterData, buildSeed } from '@/data/mock/seeds';
import type { AttendanceSubmission, Correction, StaffAttendanceRecord, SyncState } from '@/domain/attendance';
import {
  announcementToRow,
  correctionToRow,
  faceToRow,
  normalizeTimestamp,
  ojtToRow,
  rowToAnnouncement,
  rowToBatch,
  rowToCorrection,
  rowToFace,
  rowToInstitute,
  rowToOjt,
  rowToStaffMember,
  rowToStaffRecord,
  rowToStudent,
  rowToSubject,
  rowToSubmission,
  rowToTimetableEntry,
  rowToTrade,
  staffRecordToRow,
  submissionToRow,
} from '@/repositories/supabase/mappers';
import type { Row } from '@/repositories/supabase/data-client';
import { mergeRecords } from '@/repositories/supabase/merge';
import { MASTER_TABLES, masterDataRows, type SqlValue } from '../../scripts/supabase/seed-sql';
import { pgTimestamp } from './supabase-fake';

const TODAY = '2026-09-25';

const submission: AttendanceSubmission = {
  id: 'att_1',
  sessionKey: 'ele-s1u2.2026-09-25.daily',
  address: { batchId: 'ele-s1u2', date: TODAY, slot: { kind: 'daily' } },
  marks: { 'ele-s1u2-r01': { status: 'present' }, 'ele-s1u2-r02': { status: 'leave', leaveType: 'sick', leaveUntil: '2026-09-27' } },
  markedBy: 'st-rajesh',
  deviceTimestamp: '2026-09-25T04:45:12.345Z',
  location: { lat: 18.53, lng: 73.85, accuracyM: 12, distanceM: 40, source: 'simulated' },
  syncState: 'pending',
};

describe('timestamps', () => {
  it('normalises PostgREST timestamptz (+00:00, no milliseconds) to the app ISO form', () => {
    expect(normalizeTimestamp('2026-09-25T04:45:00+00:00')).toBe('2026-09-25T04:45:00.000Z');
    expect(normalizeTimestamp('2026-09-25T10:15:00.5+05:30')).toBe('2026-09-25T04:45:00.500Z');
    expect(normalizeTimestamp(pgTimestamp('2026-09-25T04:45:12.345Z'))).toBe('2026-09-25T04:45:12.345Z');
  });
});

describe('submissions', () => {
  it('maps to a row without institute_id or server_timestamp (the server decides both) and origin app', () => {
    const row = submissionToRow(submission);
    expect(row).toEqual({
      id: 'att_1',
      session_key: 'ele-s1u2.2026-09-25.daily',
      batch_id: 'ele-s1u2',
      date: TODAY,
      slot: { kind: 'daily' },
      subject_id: null,
      marks: submission.marks,
      marked_by: 'st-rajesh',
      device_timestamp: '2026-09-25T04:45:12.345Z',
      location: submission.location,
      origin: 'app',
    });
  });

  it('reads a server row back as a synced submission with normalised timestamps', () => {
    const row = { ...submissionToRow(submission), institute_id: 'inst-27410', device_timestamp: pgTimestamp(submission.deviceTimestamp), server_timestamp: '2026-09-25T04:46:00+00:00' };
    expect(rowToSubmission(row)).toEqual({ ...submission, syncState: 'synced', serverTimestamp: '2026-09-25T04:46:00.000Z' });
  });

  it('keeps a subject session and drops null optionals', () => {
    const es: AttendanceSubmission = {
      id: 'att_2',
      sessionKey: 'ele-s1u1.2026-09-25.p3.es',
      address: { batchId: 'ele-s1u1', date: TODAY, slot: { kind: 'period', periodNo: 3 }, subjectId: 'es' },
      marks: {},
      markedBy: 'st-es',
      deviceTimestamp: '2026-09-25T05:00:00.000Z',
      syncState: 'synced',
      serverTimestamp: '2026-09-25T05:00:01.000Z',
    };
    const row: Row = { ...submissionToRow(es), server_timestamp: '2026-09-25T05:00:01+00:00' };
    expect(row.subject_id).toBe('es');
    expect(row.location).toBeNull();
    const back = rowToSubmission(row);
    expect(back).toStrictEqual(es);
  });
});

describe('corrections and staff records', () => {
  it('round-trips a correction (reason code optional)', () => {
    const c: Correction = {
      correctionId: 'corr_1',
      attendanceId: 'att_1',
      studentId: 'ele-s1u2-r02',
      oldMark: { status: 'absent' },
      newMark: { status: 'present' },
      reason: 'Arrived late',
      reasonCode: 'late',
      actorId: 'st-anil',
      timestamp: '2026-09-25T06:00:00.000Z',
    };
    expect(rowToCorrection({ ...correctionToRow(c), timestamp: pgTimestamp(c.timestamp) })).toStrictEqual(c);
    const { reasonCode: _drop, ...free } = c;
    expect(correctionToRow(free).reason_code).toBeNull();
    expect(rowToCorrection(correctionToRow(free))).toStrictEqual(free);
  });

  it('round-trips a staff record as synced', () => {
    const r: StaffAttendanceRecord = { id: 'staff_1', staffId: 'st-rajesh', date: TODAY, status: 'present', source: 'self', markedBy: 'st-rajesh', deviceTimestamp: '2026-09-25T04:40:00.000Z', syncState: 'pending' };
    const row = staffRecordToRow(r);
    expect(row).not.toHaveProperty('institute_id');
    expect(row).not.toHaveProperty('sync_state');
    expect(rowToStaffRecord({ ...row, device_timestamp: pgTimestamp(r.deviceTimestamp) })).toStrictEqual({ ...r, syncState: 'synced' });
  });

  it('maps the seeded demo story without loss (what the Task 11 seeder will send)', () => {
    const seed = buildSeed(TODAY);
    for (const s of seed.submissions) expect(rowToSubmission({ ...submissionToRow(s), server_timestamp: s.serverTimestamp ?? s.deviceTimestamp })).toEqual({ ...s, syncState: 'synced', serverTimestamp: s.serverTimestamp ?? s.deviceTimestamp });
    for (const c of seed.corrections) expect(rowToCorrection(correctionToRow(c))).toEqual(c);
    for (const r of seed.staffRecords) expect(rowToStaffRecord(staffRecordToRow(r))).toEqual({ ...r, syncState: 'synced' });
    for (const f of seed.faceEnrolments) expect(rowToFace(faceToRow(f))).toEqual(f);
  });
});

describe('master data', () => {
  it('reads back exactly the rows the Task 9 seed generator wrote', () => {
    const master = buildMasterData(TODAY);
    const rows = masterDataRows(master);
    const unwrap = (v: SqlValue) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as { json: unknown }).json : v);
    const objects = Object.fromEntries(
      MASTER_TABLES.map((t) => [t.table, rows[t.table].map((values) => Object.fromEntries(t.columns.map((c, i) => [c, unwrap(values[i]) ?? null])))]),
    ) as Record<string, Array<Record<string, unknown>>>;
    expect(objects.institutes.map(rowToInstitute)).toStrictEqual(master.institutes.map((i) => ({ ...i })));
    expect(objects.subjects.map(rowToSubject)).toEqual(master.subjects);
    expect(objects.trades.map(rowToTrade)).toEqual(master.trades);
    expect(objects.batches.map(rowToBatch)).toEqual(master.batches);
    expect(objects.students.map(rowToStudent)).toEqual(master.students);
    expect(objects.staff.map(rowToStaffMember)).toEqual(master.staff);
    expect(objects.timetable.map(rowToTimetableEntry)).toEqual(master.timetable);
  });

  it('round-trips OJT declarations and announcements', () => {
    const master = buildMasterData(TODAY);
    for (const o of master.ojt) expect(rowToOjt({ ...ojtToRow(o), institute_id: 'inst-27410' })).toStrictEqual(o);
    for (const a of buildAnnouncements(TODAY)) {
      const row = announcementToRow(a);
      expect(rowToAnnouncement({ ...row, published_at: pgTimestamp(a.publishedAt) })).toStrictEqual(a);
    }
  });
});

describe('mergeRecords (D-143: the device\'s own unsynced records win)', () => {
  type Rec = { id: string; key: string; syncState: SyncState; from?: string };
  const server = (id: string, key: string): Rec => ({ id, key, syncState: 'synced' });
  it('keeps every server row and adds local rows the server does not have', () => {
    const merged = mergeRecords<Rec>([server('a', 'k1')], [{ id: 'b', key: 'k2', syncState: 'pending' }], (r) => r.key);
    expect(merged.map((r) => r.id).sort()).toEqual(['a', 'b']);
  });
  it('lets a local pending record win for its key', () => {
    const merged = mergeRecords<Rec>([server('theirs', 'k1')], [{ id: 'mine', key: 'k1', syncState: 'failed' }], (r) => r.key);
    expect(merged).toEqual([{ id: 'mine', key: 'k1', syncState: 'failed' }]);
  });
  it('Task 15: prefers the server copy over a device copy the server refused (rejected), and keeps the rejected one only when the server copy is not there', () => {
    const merged = mergeRecords<Rec>([{ ...server('theirs', 'k1'), from: 'server' }], [{ id: 'mine', key: 'k1', syncState: 'rejected' }, { id: 'lone', key: 'k2', syncState: 'rejected' }], (r) => r.key);
    expect(merged.map((r) => `${r.id}:${r.syncState}`).sort()).toEqual(['lone:rejected', 'theirs:synced']);
  });
  it('prefers the server copy over a local synced copy, and keeps the local one only when the server has none', () => {
    const merged = mergeRecords<Rec>([{ ...server('a', 'k1'), from: 'server' }], [{ id: 'a', key: 'k1', syncState: 'synced', from: 'local' }, { id: 'c', key: 'k3', syncState: 'synced', from: 'local' }], (r) => r.key);
    expect(merged.map((r) => `${r.id}:${r.from}`).sort()).toEqual(['a:server', 'c:local']);
  });
});

describe('Task 17: shared rows are checked, never trusted', () => {
  const good = { ...submissionToRow(submission), server_timestamp: '2026-09-25T04:46:00+00:00' };
  const correctionRow = (over: Row = {}): Row => ({
    ...correctionToRow({ correctionId: 'c1', attendanceId: 'att_1', studentId: 's1', oldMark: { status: 'present' }, newMark: { status: 'absent' }, reason: 'r', reasonCode: 'late', actorId: 'st-anil', timestamp: '2026-09-25T06:00:00.000Z' }),
    ...over,
  });

  it('drops mark entries with an unknown status, a half other than 1 or 2, or an unknown leave type, and extra fields', () => {
    const marks = {
      ok: { status: 'half_day', half: 2 },
      blank: { status: null },
      leave: { status: 'leave', leaveType: 'medical', leaveUntil: '2026-09-30', extra: 'x' },
      unknown: { status: 'excused' },
      half3: { status: 'half_day', half: 3 },
      leaveBad: { status: 'leave', leaveType: 'vacation' },
      untilBad: { status: 'leave', leaveType: 'sick', leaveUntil: 'soon' },
      notObject: 'present',
    };
    expect(rowToSubmission({ ...good, marks })?.marks).toStrictEqual({
      ok: { status: 'half_day', half: 2 },
      blank: { status: null },
      leave: { status: 'leave', leaveType: 'medical', leaveUntil: '2026-09-30' },
    });
  });

  it('skips a submission with a bad slot or no marks object', () => {
    expect(rowToSubmission({ ...good, slot: { kind: 'half', part: 3 } })).toBeUndefined();
    expect(rowToSubmission({ ...good, slot: { kind: 'period', periodNo: -1 } })).toBeUndefined();
    expect(rowToSubmission({ ...good, slot: { kind: 'weekly' } })).toBeUndefined();
    expect(rowToSubmission({ ...good, slot: null })).toBeUndefined();
    expect(rowToSubmission({ ...good, marks: null })).toBeUndefined();
    expect(rowToSubmission({ ...good, slot: { kind: 'half', part: 2 } })?.address.slot).toStrictEqual({ kind: 'half', part: 2 });
    expect(rowToSubmission({ ...good, slot: { kind: 'period', periodNo: 4 } })?.address.slot).toStrictEqual({ kind: 'period', periodNo: 4 });
  });

  it('skips a correction with a bad mark, drops an unknown reason code, and reads the server sequence', () => {
    expect(rowToCorrection(correctionRow({ new_mark: { status: 'gone' } }))).toBeUndefined();
    expect(rowToCorrection(correctionRow({ old_mark: null }))).toBeUndefined();
    const odd = rowToCorrection(correctionRow({ reason_code: 'bribe' }));
    expect(odd).toBeDefined();
    expect(odd).not.toHaveProperty('reasonCode');
    expect(rowToCorrection(correctionRow({ seq: 7 }))?.seq).toBe(7);
    expect(rowToCorrection(correctionRow({ seq: '12' }))?.seq).toBe(12);
  });

  it('skips a staff record with an unknown status or source', () => {
    const r = staffRecordToRow({ id: 's', staffId: 'st-rajesh', date: TODAY, status: 'present', source: 'self', markedBy: 'st-rajesh', deviceTimestamp: '2026-09-25T04:40:00.000Z', syncState: 'synced' });
    expect(rowToStaffRecord({ ...r, status: 'holiday' })).toBeUndefined();
    expect(rowToStaffRecord({ ...r, status: null })).toBeUndefined();
    expect(rowToStaffRecord({ ...r, source: 'robot' })).toBeUndefined();
    expect(rowToStaffRecord(r)?.status).toBe('present');
  });

  it('skips an announcement with an unknown category, priority, source, audience, text or dates', () => {
    const a = announcementToRow(buildAnnouncements(TODAY)[0]);
    expect(rowToAnnouncement(a)).toBeDefined();
    for (const bad of [
      { category: 'gossip' },
      { priority: 'urgent' },
      { source: 'anyone' },
      { audience: { kind: 'world' } },
      { audience: { kind: 'trade', tradeIds: 'ele' } },
      { title: { mr: 'फक्त मराठी' } },
      { body: 'plain' },
      { show_from: 'today' },
      { event_to: 42 },
    ]) {
      expect(rowToAnnouncement({ ...a, ...bad })).toBeUndefined();
    }
    expect(rowToAnnouncement({ ...a, audience: { kind: 'staff', staffIds: ['st-rajesh'] } })?.audience).toStrictEqual({ kind: 'staff', staffIds: ['st-rajesh'] });
  });
});
