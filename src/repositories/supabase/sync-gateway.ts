/**
 * The sync's server on Supabase (D-143). Inserts a locked record. A unique-key conflict (23505) means the record
 * is already there: with the same id it is this device's own earlier push (the answer was lost), so it counts as
 * success; with a different id someone else submitted first, so it is `rejected`, which is final: the sync stops
 * pushing it and reads show the server's copy. A network failure is `network` (the queue keeps it). Any other
 * refusal (RLS, a missing parent) is a set-up problem on the server that a fix clears, so it is answered as
 * `network` too and the record is tried again instead of being given up.
 */
import type { AttendanceSubmission, StaffAttendanceRecord } from '@/domain/attendance';
import { err, ok, type Result } from '@/lib/result';
import type { Clock } from '@/lib/time';
import type { SyncGateway } from '../interfaces';
import { eq, UNIQUE_VIOLATION, type DataClient, type DataResult, type Filter, type Row, type TableName } from './data-client';
import { normalizeTimestamp, staffRecordToRow, submissionToRow } from './mappers';

type PushResult = Result<{ serverTimestamp: string }, 'network' | 'rejected'>;

export interface SupabaseSyncGatewayDeps {
  readonly client: DataClient;
  readonly clock: Clock;
  /** Demo knob: the next sync fails (SimulationSource.nextSyncFails). */
  readonly blocked?: () => boolean;
  /** After a submission reached the server (its waiting corrections can follow). */
  readonly onSubmissionPushed?: () => void;
}

export class SupabaseSyncGateway implements SyncGateway {
  constructor(private readonly deps: SupabaseSyncGatewayDeps) {}

  async pushSubmission(submission: AttendanceSubmission): Promise<PushResult> {
    const result = await this.push('submissions', submissionToRow(submission), submission.id, [[eq('session_key', submission.sessionKey)], [eq('id', submission.id)]], (row) =>
      normalizeTimestamp(row.server_timestamp ?? this.deps.clock.now().toISOString()),
    );
    if (result.ok) this.deps.onSubmissionPushed?.();
    return result;
  }

  pushStaffRecord(record: StaffAttendanceRecord): Promise<PushResult> {
    // staff_attendance has no server time column: the sync only needs to know it arrived.
    return this.push('staff_attendance', staffRecordToRow(record), record.id, [[eq('staff_id', record.staffId), eq('date', record.date)], [eq('id', record.id)]], () =>
      this.deps.clock.now().toISOString(),
    );
  }

  private async push(table: TableName, row: Row, id: string, uniqueKeys: Filter[][], serverTime: (row: Row) => string): Promise<PushResult> {
    if (this.deps.blocked?.()) return err('network');
    const inserted = await this.deps.client.insert(table, row);
    if (inserted.ok) return ok({ serverTimestamp: serverTime(inserted.data[0] ?? {}) });
    if (inserted.error.kind === 'network') return err('network');
    if (inserted.error.code !== UNIQUE_VIOLATION) return err('network');
    for (const filters of uniqueKeys) {
      const existing: DataResult<Row[]> = await this.deps.client.select({ table, order: 'id', filters });
      if (!existing.ok) return err('network');
      const found = existing.data[0];
      if (found) return found.id === id ? ok({ serverTimestamp: serverTime(found) }) : err('rejected');
    }
    return err('rejected');
  }
}
