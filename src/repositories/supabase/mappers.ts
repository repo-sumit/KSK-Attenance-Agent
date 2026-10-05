/**
 * Pure row ↔ domain mappers for the Supabase schema (supabase/migrations/*_ksk_schema.sql, Task 9). Columns are
 * snake_case; jsonb columns hold the TypeScript shapes as they are. A SQL null becomes an absent optional field.
 * Timestamps come back from PostgREST as `+00:00` without milliseconds, so every timestamptz is normalised to the
 * app's `toISOString()` form before anything compares or sorts it. Rows written by the app never carry
 * `institute_id` or `server_timestamp`: the server's triggers decide both.
 * Operational rows and announcements are shared: any device can write them (D-144), so their jsonb and enum columns
 * are checked (validate.ts, Task 17); a mapper answers undefined for a row it skips, and `selectMapped` leaves it out.
 */
import type { Announcement } from '@/domain/announcement';
import type { AttendanceSubmission, CapturedLocation, Correction, StaffAttendanceRecord } from '@/domain/attendance';
import type { FaceEnrolment } from '@/domain/device';
import type {
  AcademicYear,
  Batch,
  EmploymentType,
  GeoPoint,
  Institute,
  OjtDeclaration,
  PeriodKind,
  ShiftNo,
  StaffMember,
  StaffRole,
  Student,
  Subject,
  TimetableEntry,
  Trade,
} from '@/domain/entities';
import type { Row } from './data-client';
import {
  isCategory,
  isDate,
  isOptionalDate,
  isPriority,
  isSource,
  isStaffSource,
  isStatus,
  parseAudience,
  parseMark,
  parseMarks,
  parseReasonCode,
  parseSeq,
  parseSlot,
  parseText,
} from './validate';

export function normalizeTimestamp(value: unknown): string {
  return new Date(String(value)).toISOString();
}

const text = (row: Row, column: string): string => String(row[column]);
const num = (row: Row, column: string): number => Number(row[column]);
const optional = <K extends string, V>(key: K, value: V | null | undefined): { [P in K]?: V } =>
  (value === null || value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

// ---------- Master data (read only) ----------

export function rowToInstitute(row: Row): Institute {
  return {
    id: text(row, 'id'),
    code: text(row, 'code'),
    name: text(row, 'name'),
    shortName: text(row, 'short_name'),
    district: text(row, 'district'),
    locality: text(row, 'locality'),
    location: row.location as GeoPoint,
    ...optional('shiftWindows', row.shift_windows as Institute['shiftWindows'] | null),
  };
}

export const rowToSubject = (row: Row): Subject => ({ id: text(row, 'id'), name: text(row, 'name') });

export const rowToTrade = (row: Row): Trade => ({
  id: text(row, 'id'),
  instituteId: text(row, 'institute_id'),
  name: text(row, 'name'),
  durationYears: num(row, 'duration_years') as AcademicYear,
});

export const rowToBatch = (row: Row): Batch => ({
  id: text(row, 'id'),
  tradeId: text(row, 'trade_id'),
  shift: num(row, 'shift') as ShiftNo,
  unit: num(row, 'unit'),
  year: num(row, 'year') as AcademicYear,
});

export const rowToStudent = (row: Row): Student => ({
  id: text(row, 'id'),
  batchId: text(row, 'batch_id'),
  rollNo: num(row, 'roll_no'),
  name: text(row, 'name'),
  fatherName: text(row, 'father_name'),
});

export const rowToStaffMember = (row: Row): StaffMember => ({
  id: text(row, 'id'),
  instituteId: text(row, 'institute_id'),
  trainerId: text(row, 'trainer_id'),
  name: text(row, 'name'),
  role: text(row, 'role') as StaffRole,
  employmentType: text(row, 'employment_type') as EmploymentType,
  designation: text(row, 'designation'),
  ...optional('primaryTradeId', row.primary_trade_id as string | null),
  secondaryTradeIds: strings(row.secondary_trade_ids),
  batchIds: strings(row.batch_ids),
  ...optional('subjectId', row.subject_id as string | null),
  multiTradeAllowed: Boolean(row.multi_trade_allowed),
});

export const rowToTimetableEntry = (row: Row): TimetableEntry => ({
  id: text(row, 'id'),
  batchId: text(row, 'batch_id'),
  instructorId: text(row, 'instructor_id'),
  weekday: num(row, 'weekday'),
  periodNo: num(row, 'period_no'),
  kind: text(row, 'kind') as PeriodKind,
  window: { start: text(row, 'window_start'), end: text(row, 'window_end') },
  ...optional('subjectId', row.subject_id as string | null),
});

export const rowToOjt = (row: Row): OjtDeclaration => ({
  id: text(row, 'id'),
  studentIds: strings(row.student_ids),
  from: text(row, 'from_date'),
  to: text(row, 'to_date'),
});

/** For the demo seeder (Task 11); `institute_id` is filled by the server from the first student. */
export const ojtToRow = (o: OjtDeclaration): Row => ({ id: o.id, student_ids: [...o.studentIds], from_date: o.from, to_date: o.to });

/** Undefined (skipped) when any field is outside what the app knows. */
export function rowToAnnouncement(row: Row): Announcement | undefined {
  const { category, priority, source, show_from: showFrom, show_until: showUntil, event_from: eventFrom, event_to: eventTo } = row;
  const audience = parseAudience(row.audience);
  const title = parseText(row.title);
  const body = parseText(row.body);
  if (!isCategory(category) || !isPriority(priority) || !isSource(source) || !audience || !title || !body) return undefined;
  if (!isDate(showFrom) || !isDate(showUntil) || !isOptionalDate(eventFrom) || !isOptionalDate(eventTo)) return undefined;
  return {
    id: text(row, 'id'),
    instituteId: text(row, 'institute_id'),
    category,
    priority,
    source,
    audience,
    title,
    body,
    publishedAt: normalizeTimestamp(row.published_at),
    showFrom,
    showUntil,
    ...optional('eventFrom', eventFrom),
    ...optional('eventTo', eventTo),
  };
}

export const announcementToRow = (a: Announcement): Row => ({
  id: a.id,
  institute_id: a.instituteId,
  category: a.category,
  priority: a.priority,
  source: a.source,
  audience: a.audience,
  title: a.title,
  body: a.body,
  published_at: a.publishedAt,
  show_from: a.showFrom,
  show_until: a.showUntil,
  event_from: a.eventFrom ?? null,
  event_to: a.eventTo ?? null,
});

// ---------- Operational records (write-once; corrections append-only) ----------

/** A server row is synced by definition (syncState is not stored). Skipped without a valid slot or marks object. */
export function rowToSubmission(row: Row): AttendanceSubmission | undefined {
  const subjectId = row.subject_id as string | null;
  const slot = parseSlot(row.slot);
  const marks = parseMarks(row.marks);
  if (!slot || !marks) return undefined;
  return {
    id: text(row, 'id'),
    sessionKey: text(row, 'session_key'),
    address: { batchId: text(row, 'batch_id'), date: text(row, 'date'), slot, ...optional('subjectId', subjectId) },
    marks,
    markedBy: text(row, 'marked_by'),
    deviceTimestamp: normalizeTimestamp(row.device_timestamp),
    ...optional('serverTimestamp', row.server_timestamp ? normalizeTimestamp(row.server_timestamp) : null),
    ...optional('location', row.location as CapturedLocation | null),
    syncState: 'synced',
  };
}

export const submissionToRow = (s: AttendanceSubmission): Row => ({
  id: s.id,
  session_key: s.sessionKey,
  batch_id: s.address.batchId,
  date: s.address.date,
  slot: s.address.slot,
  subject_id: s.address.subjectId ?? null,
  marks: s.marks,
  marked_by: s.markedBy,
  device_timestamp: s.deviceTimestamp,
  location: s.location ?? null,
  origin: 'app',
});

/** A correction as the server holds it: `seq` is its insert order (GENERATED ALWAYS, never sent; Task 17). */
export type SequencedCorrection = Correction & { readonly seq?: number };

/** Skipped when either mark is invalid; an unknown reason code is dropped (the free-text reason stays). */
export function rowToCorrection(row: Row): SequencedCorrection | undefined {
  const oldMark = parseMark(row.old_mark);
  const newMark = parseMark(row.new_mark);
  if (!oldMark || !newMark) return undefined;
  return {
    correctionId: text(row, 'correction_id'),
    attendanceId: text(row, 'attendance_id'),
    studentId: text(row, 'student_id'),
    oldMark,
    newMark,
    reason: text(row, 'reason'),
    ...optional('reasonCode', parseReasonCode(row.reason_code)),
    actorId: text(row, 'actor_id'),
    timestamp: normalizeTimestamp(row.timestamp),
    ...optional('seq', parseSeq(row.seq)),
  };
}

export const correctionToRow = (c: Correction): Row => ({
  correction_id: c.correctionId,
  attendance_id: c.attendanceId,
  student_id: c.studentId,
  old_mark: c.oldMark,
  new_mark: c.newMark,
  reason: c.reason,
  reason_code: c.reasonCode ?? null,
  actor_id: c.actorId,
  timestamp: c.timestamp,
});

/** Skipped with an unknown status or source. */
export function rowToStaffRecord(row: Row): StaffAttendanceRecord | undefined {
  const { status, source } = row;
  if (!isStatus(status) || !isStaffSource(source)) return undefined;
  return {
    id: text(row, 'id'),
    staffId: text(row, 'staff_id'),
    date: text(row, 'date'),
    status,
    source,
    markedBy: text(row, 'marked_by'),
    deviceTimestamp: normalizeTimestamp(row.device_timestamp),
    ...optional('location', row.location as CapturedLocation | null),
    syncState: 'synced',
  };
}

export const staffRecordToRow = (r: StaffAttendanceRecord): Row => ({
  id: r.id,
  staff_id: r.staffId,
  date: r.date,
  status: r.status,
  source: r.source,
  marked_by: r.markedBy,
  device_timestamp: r.deviceTimestamp,
  location: r.location ?? null,
});

export const rowToFace = (row: Row): FaceEnrolment => ({
  staffId: text(row, 'staff_id'),
  enrolledAt: normalizeTimestamp(row.enrolled_at),
  sampleCount: num(row, 'sample_count'),
  simulated: true,
});

export const faceToRow = (f: FaceEnrolment): Row => ({ staff_id: f.staffId, enrolled_at: f.enrolledAt, sample_count: f.sampleCount, simulated: true });
