/**
 * Staff attendance on Supabase, offline-first like student attendance (D-143): device writes, merged reads. A live read
 * also drops the device's synced marks the server no longer has (a shared reset, Task 17), so the day can be marked again.
 * The device's marks are scoped to the signed-in institute's staff first, as the server's reads are (`inScope`).
 */
import type { StaffAttendanceRecord } from '@/domain/attendance';
import { compareDates, type LocalDate } from '@/lib/time';
import type { StaffAttendanceRepository } from '../interfaces';
import { staffKey } from '../mock/database';
import { MockStaffAttendanceRepository } from '../mock/repositories';
import { eq } from './data-client';
import { inScope, scoped, selectMapped, type SupabaseContext } from './context';
import { rowToStaffRecord } from './mappers';
import { mergeLive } from './merge';
import type { LiveRead } from './read-cache';

export const STAFF_CACHE = 'staff:';

const byPersonDay = (r: StaffAttendanceRecord) => `${r.staffId}@${r.date}`;

export class SupabaseStaffAttendanceRepository implements StaffAttendanceRepository {
  private readonly device: MockStaffAttendanceRepository;

  constructor(private readonly ctx: SupabaseContext) {
    this.device = new MockStaffAttendanceRepository(ctx.db);
  }

  private local(): StaffAttendanceRecord[] {
    return Object.values(this.ctx.db.read('staff'));
  }

  private serverDay(date: LocalDate): Promise<LiveRead<StaffAttendanceRecord[]>> {
    const scope = scoped(this.ctx);
    return this.ctx.cache.readLive(
      `${STAFF_CACHE}day:${scope.key}:${date}`,
      () => selectMapped(this.ctx.client, { table: 'staff_attendance', order: 'id', filters: [...scope.filters, eq('date', date)] }, rowToStaffRecord),
      [],
    );
  }

  async get(staffId: string, date: LocalDate) {
    return (await this.listForDate(date)).find((r) => r.staffId === staffId);
  }

  async getById(id: string) {
    const local = this.local().find((r) => r.id === id);
    if (local) return local;
    const rows = await this.ctx.cache.read(
      `${STAFF_CACHE}id:${id}`,
      () => selectMapped(this.ctx.client, { table: 'staff_attendance', order: 'id', filters: [eq('id', id)] }, rowToStaffRecord),
      [],
    );
    return rows[0];
  }

  async listForDate(date: LocalDate) {
    return this.merged(await this.serverDay(date), this.local().filter((r) => r.date === date));
  }

  /** The merge of one read, over the device's marks in the read's scope; a live read also removes the device's stale synced marks (merge.ts). */
  private async merged(read: LiveRead<readonly StaffAttendanceRecord[]>, all: readonly StaffAttendanceRecord[]): Promise<StaffAttendanceRecord[]> {
    const local = await inScope(this.ctx, all, (members, r) => members.staffIds.has(r.staffId));
    const { records, dropped } = mergeLive({ value: read.value, live: read.live && local.prunable }, local.records, byPersonDay);
    if (dropped.length) {
      const gone = new Map(dropped.map((r) => [staffKey(r.staffId, r.date), r.id]));
      this.ctx.db.update('staff', (all) => Object.fromEntries(Object.entries(all).filter(([key, r]) => gone.get(key) !== r.id)), 'staff');
    }
    return records;
  }

  async listBetween(staffIds: readonly string[], from: LocalDate, to: LocalDate) {
    if (!staffIds.length) return [];
    const ids = [...new Set(staffIds)].sort();
    const scope = scoped(this.ctx);
    const read = await this.ctx.cache.readLive(
      `${STAFF_CACHE}range:${scope.key}:${from}:${to}:${ids.join(',')}`,
      () =>
        selectMapped(
          this.ctx.client,
          {
            table: 'staff_attendance',
            order: 'id',
            filters: [...scope.filters, { column: 'staff_id', op: 'in', value: ids }, { column: 'date', op: 'gte', value: from }, { column: 'date', op: 'lte', value: to }],
          },
          rowToStaffRecord,
        ),
      [],
    );
    const wanted = new Set(ids);
    const keep = (r: StaffAttendanceRecord) => wanted.has(r.staffId) && compareDates(from, r.date) <= 0 && compareDates(r.date, to) <= 0;
    return (await this.merged({ value: read.value.filter(keep), live: read.live }, this.local().filter(keep))).sort((a, b) => a.date.localeCompare(b.date));
  }

  create(record: StaffAttendanceRecord) {
    return this.device.create(record);
  }

  async markSynced(id: string) {
    this.ctx.cache.invalidate(STAFF_CACHE);
    await this.device.markSynced(id);
  }

  async markRejected(id: string) {
    this.ctx.cache.invalidate(STAFF_CACHE);
    await this.device.markRejected(id);
  }
}
