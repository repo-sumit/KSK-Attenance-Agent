/** The attendance journey's public shapes (AttendanceService): session cards, groups, rosters and their refusals. */
import type { AttendanceSubmission, SessionAddress, SessionKey } from '@/domain/attendance';
import type { Batch, Student, Trade } from '@/domain/entities';
import type { MarkCounts } from '@/domain/marking';
import type { ScheduledSlot } from '@/domain/schedule';
import type { Mark } from '@/domain/status';
import type { MarkSource } from '@/domain/voice/types';

export type SessionStatus = 'open' | 'future' | 'closed' | 'submitted';

export interface SubmissionSummary {
  readonly id: string;
  readonly at: string;
  readonly byName: string;
  /** Locked on this phone and still on its way to the server (pending or failed). */
  readonly pendingSync: boolean;
  /** The server refused this phone's copy for good: someone else submitted the session first (shown only while the server's copy cannot be read). */
  readonly rejected: boolean;
  readonly counts: MarkCounts;
}

export interface SessionCard {
  readonly key: SessionKey;
  readonly address: SessionAddress;
  readonly batch: Batch;
  readonly trade: Trade;
  readonly scheduled: ScheduledSlot;
  readonly status: SessionStatus;
  readonly studentCount: number;
  readonly submission?: SubmissionSummary;
  /** Whether this user may open the roster now (status open + access + role rules). */
  readonly canMark: boolean;
  /**
   * Own attendance first (D-152): the batch could be marked now, but this user's own attendance for today is not
   * marked yet, so opening it is refused with `self_first`. Set only on open batches the user can mark.
   */
  readonly selfFirst?: boolean;
  /** The roster is on this phone (a batch pack), so it can be opened offline. */
  readonly downloaded: boolean;
  /** When the pack was last downloaded or refreshed, and whether that is past the refresh interval. */
  readonly pack?: { readonly downloadedAt: string; readonly stale: boolean };
}

export interface BatchGroup {
  readonly trade: Trade;
  readonly cards: readonly SessionCard[];
}

export interface SessionDetail {
  readonly card: SessionCard;
  readonly students: readonly Student[];
  readonly submission?: AttendanceSubmission;
  /** Marks after corrections; the original submission is never changed. */
  readonly marks: Readonly<Record<string, Mark>>;
  readonly correctedStudentIds: ReadonlySet<string>;
}

export type OpenRosterError =
  | 'unknown_session'
  | 'no_access'
  | 'not_today'
  | 'window_not_open'
  | 'window_closed'
  | 'already_submitted'
  /** Own attendance first (D-152). */
  | 'self_first'
  | 'not_verified'
  | 'not_downloaded'
  | 'needs_connection';

export interface RosterData {
  readonly card: SessionCard;
  readonly students: readonly Student[];
  readonly marks: Record<string, Mark>;
  /** Who made each saved trainer mark that is still valid (D-084); defaults and presets have none. */
  readonly sources?: Readonly<Record<string, MarkSource>>;
  /** Offline with a pack past its refresh interval: still usable, flagged (PRD §20.3). */
  readonly packStale: boolean;
  readonly packDownloadedAt?: string;
}
