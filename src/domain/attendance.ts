/**
 * Attendance records, marking slots and session addressing.
 *
 * A marking SESSION is one batch, on one day, in one slot (daily / half / period),
 * optionally for a cross-trade subject. It is submitted once and then locked
 * (PRD §12.1). Corrections never overwrite a submission; they append entries
 * that reference it (PRD §15.1) and the effective marks are derived.
 */
import type { BatchId, GeoPoint, StaffId, StudentId, SubjectId } from './entities';
import type { Mark, StatusCode } from './status';
import type { MarkSource } from './voice/types';
import type { LocalDate } from '@/lib/time';

export type MarkingSlot =
  | { readonly kind: 'daily' }
  | { readonly kind: 'half'; readonly part: 1 | 2 }
  | { readonly kind: 'period'; readonly periodNo: number };

export interface SessionAddress {
  readonly batchId: BatchId;
  readonly date: LocalDate;
  readonly slot: MarkingSlot;
  readonly subjectId?: SubjectId;
}

/** URL-safe identifier, e.g. "ele-s1u2.2026-09-25.p3" or "ele-s1u1.2026-09-25.daily.es". */
export type SessionKey = string;

export function slotCode(slot: MarkingSlot): string {
  switch (slot.kind) {
    case 'daily':
      return 'daily';
    case 'half':
      return `h${slot.part}`;
    case 'period':
      return `p${slot.periodNo}`;
  }
}

export function parseSlotCode(code: string): MarkingSlot | null {
  if (code === 'daily') return { kind: 'daily' };
  const half = /^h([12])$/.exec(code);
  if (half) return { kind: 'half', part: Number(half[1]) as 1 | 2 };
  const period = /^p(\d{1,2})$/.exec(code);
  if (period) return { kind: 'period', periodNo: Number(period[1]) };
  return null;
}

export function toSessionKey(address: SessionAddress): SessionKey {
  const parts = [address.batchId, address.date, slotCode(address.slot)];
  if (address.subjectId) parts.push(address.subjectId);
  return parts.join('.');
}

export function parseSessionKey(key: SessionKey): SessionAddress | null {
  const parts = key.split('.');
  if (parts.length < 3 || parts.length > 4) return null;
  const [batchId, date, code, subjectId] = parts;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !batchId) return null;
  const slot = parseSlotCode(code);
  if (!slot) return null;
  return subjectId ? { batchId, date, slot, subjectId } : { batchId, date, slot };
}

/**
 * Where a locked record stands with the server. `rejected`: the server refused it for good (for example someone
 * else submitted the same session first); it stays on the device, is not pushed again, and the server's copy wins.
 */
export type SyncState = 'synced' | 'pending' | 'failed' | 'rejected';

/** A record still on its way to the server (pending or failed). A rejected one is not: it will never be sent. */
export function awaitsSync(record: { readonly syncState: SyncState }): boolean {
  return record.syncState === 'pending' || record.syncState === 'failed';
}

export interface CapturedLocation extends GeoPoint {
  readonly accuracyM: number;
  /** Distance to the institute, when geo-fencing computed it. */
  readonly distanceM?: number;
  /**
   * Where the fix came from: 'device' = the browser Geolocation API, 'simulated' = the
   * demo's chosen outcome. Kept with the record (audit), never shown to instructors.
   */
  readonly source?: 'device' | 'simulated';
}

/** One submitted marking session. Immutable once written. */
export interface AttendanceSubmission {
  /** attendanceId */
  readonly id: string;
  readonly sessionKey: SessionKey;
  readonly address: SessionAddress;
  readonly marks: Readonly<Record<StudentId, Mark>>;
  readonly markedBy: StaffId;
  readonly deviceTimestamp: string;
  /** Set once the record reaches the server (immediately when online). */
  readonly serverTimestamp?: string;
  readonly location?: CapturedLocation;
  readonly syncState: SyncState;
}

/** Quick reasons offered on the correction screen; stored as codes so every language renders its own words. */
export type CorrectionReasonCode = 'late' | 'mistake' | 'duty';
export const CORRECTION_REASON_CODES: readonly CorrectionReasonCode[] = ['late', 'mistake', 'duty'];

/** Append-only correction entry (PRD §12.2, §12.4). */
export interface Correction {
  readonly correctionId: string;
  readonly attendanceId: string;
  readonly studentId: StudentId;
  readonly oldMark: Mark;
  readonly newMark: Mark;
  /** Free text as typed (or the chosen quick reason in the principal's language). Always present for the audit trail. */
  readonly reason: string;
  /** Set when a quick reason was chosen and not edited; screens render it in the viewer's language. */
  readonly reasonCode?: CorrectionReasonCode;
  readonly actorId: StaffId;
  readonly timestamp: string;
}

export interface AttendanceDraft {
  readonly sessionKey: SessionKey;
  readonly marks: Readonly<Record<StudentId, Mark>>;
  /** Who made each trainer mark (tap or voice, when, what was heard; D-084). Defaults and presets have none. */
  readonly sources?: Readonly<Record<StudentId, MarkSource>>;
  readonly updatedAt: string;
}

/** Marks after applying corrections in order. The submission itself is never changed. */
export function effectiveMarks(
  submission: AttendanceSubmission,
  corrections: readonly Correction[],
): Record<StudentId, Mark> {
  const marks: Record<StudentId, Mark> = { ...submission.marks };
  // Append order breaks timestamp ties (the demo clock can be frozen).
  const ordered = corrections
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.attendanceId === submission.id)
    .sort((a, b) => a.c.timestamp.localeCompare(b.c.timestamp) || a.i - b.i)
    .map(({ c }) => c);
  for (const c of ordered) marks[c.studentId] = c.newMark;
  return marks;
}

export type StaffMarkSource = 'self' | 'principal';

/** One staff member's attendance for one day (PRD §18). Locked once made. */
export interface StaffAttendanceRecord {
  readonly id: string;
  readonly staffId: StaffId;
  readonly date: LocalDate;
  readonly status: StatusCode;
  readonly source: StaffMarkSource;
  readonly markedBy: StaffId;
  readonly deviceTimestamp: string;
  readonly location?: CapturedLocation;
  readonly syncState: SyncState;
}

export type OfflineQueueKind = 'attendance_submission' | 'staff_attendance';

/** A locally locked record waiting to reach the server (PRD §20.5). */
export interface OfflineQueueItem {
  readonly id: string;
  readonly kind: OfflineQueueKind;
  /** Id of the AttendanceSubmission or StaffAttendanceRecord it carries. */
  readonly recordId: string;
  readonly label: string;
  readonly enqueuedAt: string;
  readonly attempts: number;
  readonly lastError?: string;
}
