/**
 * Master data and announcements on Supabase. An institute's master data is small (PRD §4): it is loaded once per
 * day per page session with eight parallel reads and kept in memory; rosters come from that copy. The last copy
 * is kept on the device, so sign-in and screens still work when the server cannot be reached.
 */
import type { Announcement } from '@/domain/announcement';
import type { InstituteId, MasterData } from '@/domain/entities';
import { toLocalDate } from '@/lib/time';
import type { AnnouncementRepository, MasterDataRepository } from '../interfaces';
import { eq, type DataResult, type Filter, type TableName } from './data-client';
import { selectMapped, type SupabaseContext } from './context';
import {
  rowToAnnouncement,
  rowToBatch,
  rowToInstitute,
  rowToOjt,
  rowToStaffMember,
  rowToStudent,
  rowToSubject,
  rowToTimetableEntry,
  rowToTrade,
} from './mappers';

const EMPTY: MasterData = { institutes: [], trades: [], subjects: [], batches: [], students: [], staff: [], timetable: [], ojt: [] };

export class SupabaseMasterDataRepository implements MasterDataRepository {
  constructor(private readonly ctx: SupabaseContext) {}

  private today() {
    return toLocalDate(this.ctx.clock.now());
  }

  async findInstituteByCode(code: string) {
    const clean = code.trim();
    const rows = await this.ctx.cache.read(
      `master:code:${clean}`,
      () => selectMapped(this.ctx.client, { table: 'institutes', order: 'id', filters: [eq('code', clean)] }, rowToInstitute),
      [],
      { pinned: true },
    );
    return rows[0];
  }

  /** From the institute's data: sign-in loads it right after this step anyway (auth.lookupInstructor). */
  async findStaffByTrainerId(instituteId: InstituteId, trainerId: string) {
    const id = trainerId.trim().toUpperCase();
    return (await this.getInstituteData(instituteId)).staff.find((s) => s.trainerId === id);
  }

  /**
   * One load per institute per day (the in-memory key carries the date); concurrent callers share it. The device
   * copy has no date and is pinned, so a phone that is offline on a new day still signs in and shows its reports
   * from the last copy it loaded.
   */
  getInstituteData(instituteId: InstituteId): Promise<MasterData> {
    return this.ctx.cache.read(`master:data:${instituteId}:${this.today()}`, () => this.load(instituteId), EMPTY, {
      ttlMs: Number.POSITIVE_INFINITY,
      persistAs: `master:data:${instituteId}`,
      pinned: true,
    });
  }

  async getBatchRoster(instituteId: InstituteId, batchId: string) {
    const data = await this.getInstituteData(instituteId);
    return data.batches.some((b) => b.id === batchId) ? data.students.filter((s) => s.batchId === batchId) : [];
  }

  private async load(instituteId: InstituteId): Promise<DataResult<MasterData>> {
    const own: Filter[] = [eq('institute_id', instituteId)];
    const read = <T>(table: TableName, map: (row: Record<string, unknown>) => T, filters: Filter[] = own) =>
      selectMapped(this.ctx.client, { table, order: 'id', filters }, map);
    const [institutes, trades, subjects, batches, students, staff, timetable, ojt] = await Promise.all([
      read('institutes', rowToInstitute, [eq('id', instituteId)]),
      read('trades', rowToTrade),
      read('subjects', rowToSubject, []),
      read('batches', rowToBatch),
      read('students', rowToStudent),
      read('staff', rowToStaffMember),
      read('timetable', rowToTimetableEntry),
      read('ojt', rowToOjt),
    ]);
    if (!institutes.ok) return institutes;
    if (!trades.ok) return trades;
    if (!subjects.ok) return subjects;
    if (!batches.ok) return batches;
    if (!students.ok) return students;
    if (!staff.ok) return staff;
    if (!timetable.ok) return timetable;
    if (!ojt.ok) return ojt;
    return {
      ok: true,
      data: {
        institutes: institutes.data,
        trades: trades.data,
        subjects: subjects.data,
        batches: batches.data,
        students: students.data,
        staff: staff.data,
        timetable: timetable.data,
        ojt: ojt.data,
      },
    };
  }
}

export class SupabaseAnnouncementRepository implements AnnouncementRepository {
  constructor(private readonly ctx: SupabaseContext) {}

  listForInstitute(instituteId: InstituteId): Promise<readonly Announcement[]> {
    return this.ctx.cache.read(
      `announcements:${instituteId}`,
      () => selectMapped(this.ctx.client, { table: 'announcements', order: 'id', filters: [eq('institute_id', instituteId)] }, rowToAnnouncement),
      [] as Announcement[],
    );
  }
}
