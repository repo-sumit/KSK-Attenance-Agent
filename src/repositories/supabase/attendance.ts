/**
 * Student attendance on Supabase, offline-first (D-143). Writes go to the device exactly as the mock does
 * (write-once, drafts local); the sync pushes them (sync-gateway.ts). Reads merge the server's rows with the
 * device's own (merge.ts); a live read also drops the device's synced records the server no longer has (a shared
 * reset), so those sessions can be submitted again. The device's records are scoped to the signed-in institute's
 * batches first, as the server's reads are (`inScope`). Corrections live in corrections.ts.
 */
import { parseSessionKey, type AttendanceSubmission } from '@/domain/attendance';
import { compareDates, type LocalDate } from '@/lib/time';
import type { AttendanceRepository, SubmissionQuery } from '../interfaces';
import { MockAttendanceRepository } from '../mock/repositories';
import { eq, type Filter } from './data-client';
import { inScope, scoped, selectMapped, type SupabaseContext } from './context';
import { rowToSubmission } from './mappers';
import { awaitsSync, mergeLive } from './merge';
import type { LiveRead } from './read-cache';

export const SUBMISSIONS_CACHE = 'sub:';

const bySessionKey = (s: AttendanceSubmission) => s.sessionKey;

export class SupabaseAttendanceRepository implements AttendanceRepository {
  private readonly device: MockAttendanceRepository;

  constructor(private readonly ctx: SupabaseContext) {
    this.device = new MockAttendanceRepository(ctx.db);
  }

  private local(): AttendanceSubmission[] {
    return Object.values(this.ctx.db.read('submissions'));
  }

  /** Every submission of one day at the institute: one request serves all the sessions a screen shows. */
  private serverDay(date: LocalDate): Promise<LiveRead<AttendanceSubmission[]>> {
    const scope = scoped(this.ctx);
    return this.ctx.cache.readLive(
      `${SUBMISSIONS_CACHE}day:${scope.key}:${date}`,
      () => selectMapped(this.ctx.client, { table: 'submissions', order: 'id', filters: [...scope.filters, eq('date', date)] }, rowToSubmission),
      [],
    );
  }

  async getSubmission(sessionKey: string) {
    const before = this.ctx.db.read('submissions')[sessionKey];
    if (before && awaitsSync(before)) return before;
    const address = parseSessionKey(sessionKey);
    if (!address) return before;
    const day = await this.serverDay(address.date);
    const server = day.value.filter((s) => s.sessionKey === sessionKey);
    const local = this.ctx.db.read('submissions')[sessionKey];
    const { records } = await this.merged({ value: server, live: day.live }, local ? [local] : []);
    return records[0];
  }

  /** The merge of one read, over the device's records in the read's scope; a live read also removes the device's stale synced copies (merge.ts). */
  private async merged(read: LiveRead<readonly AttendanceSubmission[]>, all: readonly AttendanceSubmission[]) {
    const local = await inScope(this.ctx, all, (members, s) => members.batchIds.has(s.address.batchId));
    const result = mergeLive({ value: read.value, live: read.live && local.prunable }, local.records, bySessionKey);
    if (result.dropped.length) {
      const gone = new Map(result.dropped.map((s) => [s.sessionKey, s.id]));
      this.ctx.db.update(
        'submissions',
        (all) => Object.fromEntries(Object.entries(all).filter(([key, s]) => gone.get(key) !== s.id)),
        'attendance',
      );
    }
    return result;
  }

  async getSubmissionById(id: string) {
    const local = this.local().find((s) => s.id === id);
    if (local) return local;
    const rows = await this.ctx.cache.read(
      `${SUBMISSIONS_CACHE}id:${id}`,
      () => selectMapped(this.ctx.client, { table: 'submissions', order: 'id', filters: [eq('id', id)] }, rowToSubmission),
      [],
    );
    return rows[0];
  }

  async listSubmissions(query: SubmissionQuery) {
    if (query.batchIds && query.batchIds.length === 0) return [];
    const wanted = query.batchIds ? new Set(query.batchIds) : undefined;
    const keep = (s: AttendanceSubmission) =>
      compareDates(query.from, s.address.date) <= 0 && compareDates(s.address.date, query.to) <= 0 && (!wanted || wanted.has(s.address.batchId));
    const read = query.from === query.to ? await this.serverDay(query.from) : await this.serverRange(query);
    return (await this.merged({ value: read.value.filter(keep), live: read.live }, this.local().filter(keep))).records;
  }

  private serverRange(query: SubmissionQuery): Promise<LiveRead<AttendanceSubmission[]>> {
    const scope = scoped(this.ctx);
    const batches = query.batchIds ? [...query.batchIds].sort() : undefined;
    const filters: Filter[] = [...scope.filters, { column: 'date', op: 'gte', value: query.from }, { column: 'date', op: 'lte', value: query.to }];
    if (batches) filters.push({ column: 'batch_id', op: 'in', value: batches });
    return this.ctx.cache.readLive(
      `${SUBMISSIONS_CACHE}range:${scope.key}:${query.from}:${query.to}:${batches?.join(',') ?? '*'}`,
      () => selectMapped(this.ctx.client, { table: 'submissions', order: 'id', filters }, rowToSubmission),
      [],
    );
  }

  createSubmission(submission: AttendanceSubmission) {
    return this.device.createSubmission(submission);
  }

  async markSubmissionSynced(id: string, serverTimestamp: string) {
    this.ctx.cache.invalidate(SUBMISSIONS_CACHE);
    await this.device.markSubmissionSynced(id, serverTimestamp);
  }

  /** Someone else's submission is on the server: from now on reads show it, and this device's copy only waits to be surfaced. */
  async markSubmissionRejected(id: string) {
    this.ctx.cache.invalidate(SUBMISSIONS_CACHE);
    await this.device.markSubmissionRejected(id);
  }

  getDraft(sessionKey: string) {
    return this.device.getDraft(sessionKey);
  }
  saveDraft(draft: Parameters<AttendanceRepository['saveDraft']>[0]) {
    return this.device.saveDraft(draft);
  }
  deleteDraft(sessionKey: string) {
    return this.device.deleteDraft(sessionKey);
  }
}
