'use client';
import type { StaffAttendanceRecord } from '@/domain/attendance';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';

export interface MyStaffRecord {
  /**
   * False until the first load settles; afterwards kept while a refresh runs, so the card never jumps. A failed read
   * counts as settled: the card says Not marked instead of loading for ever.
   */
  readonly loaded: boolean;
  readonly record?: StaffAttendanceRecord;
  /** Own attendance first (D-152): the rule applies and today's own attendance is known to be missing. */
  readonly selfFirst: boolean;
}

/** This user's own staff record for today (the My attendance card), refreshed on every staff change. */
export function useMyStaffRecord(): MyStaffRecord {
  const ctx = useSession();
  const { staffAttendance } = useServices();
  const on = ctx.journey.staff.selfCard;
  const { data, error, stale } = useQuery(`my-staff:${ctx.user.id}:${on}`, async () => ({ record: on ? await staffAttendance.myRecord(ctx) : undefined }), ['staff']);
  // Data held for a previous key (self-marking just turned on, another user) is not today's answer: not loaded yet.
  const current = stale ? undefined : data;
  const loaded = !stale && (data !== undefined || error !== undefined);
  // Only a record known to be missing moves the card first; after a failed read it stays in its usual place.
  return { loaded, record: current?.record, selfFirst: ctx.journey.staff.selfFirst && current !== undefined && !current.record };
}
