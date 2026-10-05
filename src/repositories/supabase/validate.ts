/**
 * Checks for the jsonb and enum columns of shared server rows (Task 17). Any device with the publishable key can write
 * them (D-144), so a mapper never casts them into domain types unchecked: an invalid mark entry is dropped, and a row
 * whose shape is wrong (slot, marks, a correction's marks, a staff status, an announcement field) is skipped. Pure.
 */
import type { AnnouncementAudience, AnnouncementCategory, AnnouncementSource, LocalizedText } from '@/domain/announcement';
import { CORRECTION_REASON_CODES, type CorrectionReasonCode, type MarkingSlot, type StaffMarkSource } from '@/domain/attendance';
import { LEAVE_TYPES, STATUS_ORDER, type Half, type LeaveType, type Mark, type StatusCode } from '@/domain/status';

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose => typeof value === 'object' && value !== null && !Array.isArray(value);
const oneOf = <T extends string>(options: readonly T[], value: unknown): value is T => typeof value === 'string' && (options as readonly string[]).includes(value);
const absent = (value: unknown): value is null | undefined => value === null || value === undefined;
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

export const isStatus = (value: unknown): value is StatusCode => oneOf(STATUS_ORDER, value);

/** A mark with only the fields the app knows, each checked; undefined when any of them is wrong. */
export function parseMark(value: unknown): Mark | undefined {
  if (!isObject(value)) return undefined;
  const { status, half, leaveType, leaveUntil } = value;
  if (status !== null && !isStatus(status)) return undefined;
  if (!absent(half) && half !== 1 && half !== 2) return undefined;
  if (!absent(leaveType) && !oneOf(LEAVE_TYPES, leaveType)) return undefined;
  if (!absent(leaveUntil) && !isDate(leaveUntil)) return undefined;
  return {
    status,
    ...(absent(half) ? {} : { half: half as Half }),
    ...(absent(leaveType) ? {} : { leaveType: leaveType as LeaveType }),
    ...(absent(leaveUntil) ? {} : { leaveUntil }),
  };
}

/** The valid entries of a marks object (invalid ones dropped); undefined when it is not an object at all. */
export function parseMarks(value: unknown): Record<string, Mark> | undefined {
  if (!isObject(value)) return undefined;
  const out: Record<string, Mark> = {};
  for (const [studentId, raw] of Object.entries(value)) {
    const mark = parseMark(raw);
    if (mark) out[studentId] = mark;
  }
  return out;
}

export function parseSlot(value: unknown): MarkingSlot | undefined {
  if (!isObject(value)) return undefined;
  if (value.kind === 'daily') return { kind: 'daily' };
  if (value.kind === 'half' && (value.part === 1 || value.part === 2)) return { kind: 'half', part: value.part };
  if (value.kind === 'period' && Number.isInteger(value.periodNo) && (value.periodNo as number) >= 1) return { kind: 'period', periodNo: value.periodNo as number };
  return undefined;
}

export const parseReasonCode = (value: unknown): CorrectionReasonCode | undefined => (oneOf(CORRECTION_REASON_CODES, value) ? value : undefined);

export const isStaffSource = (value: unknown): value is StaffMarkSource => oneOf(['self', 'principal'] as const, value);

/** The server's insert order for a correction (a bigint, which PostgREST may send as a number or a string). */
export function parseSeq(value: unknown): number | undefined {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isSafeInteger(n) ? n : undefined;
}

// ---------- Announcements ----------

const CATEGORIES: readonly AnnouncementCategory[] = ['info', 'important', 'holiday', 'ojt'];
const SOURCES: readonly AnnouncementSource[] = ['state', 'institute', 'principal'];

export const isCategory = (value: unknown): value is AnnouncementCategory => oneOf(CATEGORIES, value);
export const isSource = (value: unknown): value is AnnouncementSource => oneOf(SOURCES, value);
export const isPriority = (value: unknown): value is 'high' | 'normal' => oneOf(['high', 'normal'] as const, value);
export const isOptionalDate = (value: unknown): value is string | null | undefined => absent(value) || isDate(value);
export { isDate };

export function parseAudience(value: unknown): AnnouncementAudience | undefined {
  if (!isObject(value)) return undefined;
  switch (value.kind) {
    case 'institute':
      return { kind: 'institute' };
    case 'trade':
      return isStrings(value.tradeIds) ? { kind: 'trade', tradeIds: [...value.tradeIds] } : undefined;
    case 'batch':
      return isStrings(value.batchIds) ? { kind: 'batch', batchIds: [...value.batchIds] } : undefined;
    case 'staff':
      return isStrings(value.staffIds) ? { kind: 'staff', staffIds: [...value.staffIds] } : undefined;
    default:
      return undefined;
  }
}

/** English is required (the fallback); Marathi is optional. */
export function parseText(value: unknown): LocalizedText | undefined {
  if (!isObject(value) || typeof value.en !== 'string') return undefined;
  if (!absent(value.mr) && typeof value.mr !== 'string') return undefined;
  return { en: value.en, ...(typeof value.mr === 'string' ? { mr: value.mr } : {}) };
}
