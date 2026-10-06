/**
 * AttendanceService — the student-marking journey: which sessions a user sees
 * and can open, opening a roster (only after verification), drafts that survive
 * a dropped connection, and submit-once-then-lock (PRD §7–12, §16.1, §20.4).
 */
import { canMarkBatch } from '@/domain/access';
import {
  awaitsSync,
  effectiveMarks,
  parseSessionKey,
  toSessionKey,
  type AttendanceSubmission,
  type Correction,
  type SessionAddress,
  type SessionKey,
} from '@/domain/attendance';
import type { Batch, Trade } from '@/domain/entities';
import { countMarks, initialMarks, isMarkAllowed } from '@/domain/marking';
import { checkSelfFirst, checkSubmission, type SubmitError } from '@/domain/rules';
import { sameSlot, slotsForBatch, windowState, type ScheduledSlot, type WindowState } from '@/domain/schedule';
import { marksEqual, type Mark } from '@/domain/status';
import type { MarkSource } from '@/domain/voice/types';
import { createId } from '@/lib/ids';
import { err, ok, type Result } from '@/lib/result';
import { addDays, compareDates, toLocalDate, type LocalDate } from '@/lib/time';
import type {
  AttendanceRepository,
  BatchPackRepository,
  CorrectionRepository,
  OfflineQueueRepository,
  StaffAttendanceRepository,
  VerificationRepository,
} from '@/repositories/interfaces';
import type { BatchGroup, OpenRosterError, RosterData, SessionCard, SessionDetail, SessionStatus, SubmissionSummary } from './attendance-types';
import type { SessionContext } from './context';

export type { BatchGroup, OpenRosterError, RosterData, SessionCard, SessionDetail, SessionStatus, SubmissionSummary } from './attendance-types';

export interface AttendanceDeps {
  readonly attendance: AttendanceRepository;
  readonly corrections: CorrectionRepository;
  readonly verification: VerificationRepository;
  /** Staff records, read for own attendance first (D-152). */
  readonly staffAttendance: StaffAttendanceRepository;
  readonly offlineQueue: OfflineQueueRepository;
  readonly packs: BatchPackRepository;
  readonly isOnline: () => boolean;
  readonly isPackStale: (downloadedAt: string) => boolean;
  /** Called after a record is locked locally, so sync can push it. */
  readonly onRecordQueued: () => void;
  /** Simulated write time, so "Submitting attendance…" is seen (absent in tests). */
  readonly delay?: (ms: number) => Promise<void>;
}

export class AttendanceService {
  constructor(private readonly deps: AttendanceDeps) {}

  private today(ctx: SessionContext): LocalDate {
    return toLocalDate(ctx.clock.now());
  }

  /**
   * Own attendance first (D-152): true while journey.staff.selfFirst holds and this user has no staff record today
   * (a principal's mark counts). Read once per call; users without the rule never read the records.
   */
  private async selfFirstBlocks(ctx: SessionContext): Promise<boolean> {
    if (!ctx.journey.staff.selfFirst) return false;
    const own = await this.deps.staffAttendance.get(ctx.user.id, this.today(ctx));
    return !checkSelfFirst({ required: true, ownRecordToday: own }).ok;
  }

  private trade(ctx: SessionContext, batch: Batch): Trade {
    const trade = ctx.data.trades.find((t) => t.id === batch.tradeId);
    if (!trade) throw new Error(`Batch ${batch.id} has no trade`);
    return trade;
  }

  /** Subjects taught separately in this batch (e.g. Employability Skills), for the principal's view. */
  private subjectsForBatch(ctx: SessionContext, batchId: string): string[] {
    const fromStaff = ctx.data.staff.filter((s) => s.subjectId && s.batchIds.includes(batchId)).map((s) => s.subjectId!);
    const fromTimetable = ctx.data.timetable.filter((t) => t.batchId === batchId && t.subjectId).map((t) => t.subjectId!);
    return [...new Set([...fromStaff, ...fromTimetable])];
  }

  private async summarize(ctx: SessionContext, submission: AttendanceSubmission | undefined): Promise<SubmissionSummary | undefined> {
    if (!submission) return undefined;
    const corrections = await this.deps.corrections.listForAttendance([submission.id]);
    const by = ctx.data.staff.find((s) => s.id === submission.markedBy);
    return {
      id: submission.id,
      at: submission.deviceTimestamp,
      byName: by?.name ?? submission.markedBy,
      pendingSync: awaitsSync(submission),
      rejected: submission.syncState === 'rejected',
      counts: countMarks(effectiveMarks(submission, corrections)),
    };
  }

  private async packInfo(batchId: string): Promise<Pick<SessionCard, 'downloaded' | 'pack'>> {
    const pack = (await this.deps.packs.list()).find((p) => p.batchId === batchId);
    return pack ? { downloaded: true, pack: { downloadedAt: pack.downloadedAt, stale: this.deps.isPackStale(pack.downloadedAt) } } : { downloaded: false };
  }

  private async card(ctx: SessionContext, batch: Batch, scheduled: ScheduledSlot, subjectId: string | undefined, selfFirst: boolean): Promise<SessionCard> {
    const address: SessionAddress = { batchId: batch.id, date: this.today(ctx), slot: scheduled.slot, ...(subjectId ? { subjectId } : {}) };
    const key = toSessionKey(address);
    const submission = await this.deps.attendance.getSubmission(key);
    const state: WindowState = windowState(scheduled.window, ctx.clock.now());
    const status: SessionStatus = submission ? 'submitted' : state;
    const allowed = ctx.journey.isPrincipal ? ctx.journey.principalCanMarkStudents : canMarkBatch(ctx.access, batch.id);
    const canMark = status === 'open' && allowed;
    return {
      key,
      address,
      batch,
      trade: this.trade(ctx, batch),
      scheduled,
      status,
      studentCount: ctx.data.students.filter((s) => s.batchId === batch.id).length,
      submission: await this.summarize(ctx, submission),
      canMark,
      ...(canMark && selfFirst ? { selfFirst: true } : {}),
      ...(await this.packInfo(batch.id)),
    };
  }

  /** Every session this user sees for one batch today. */
  async cardsForBatch(ctx: SessionContext, batchId: string): Promise<SessionCard[]> {
    return this.batchCards(ctx, batchId, await this.selfFirstBlocks(ctx));
  }

  /** cardsForBatch with the own-attendance answer already read once for a whole board (D-152). */
  private async batchCards(ctx: SessionContext, batchId: string, blocks: boolean): Promise<SessionCard[]> {
    const batch = ctx.data.batches.find((b) => b.id === batchId);
    if (!batch) return [];
    const subjects: Array<string | undefined> = ctx.journey.isPrincipal ? [undefined, ...this.subjectsForBatch(ctx, batchId)] : [ctx.access.subjectId];
    const instructorId = ctx.config.mapping.model === 'timetable' && !ctx.journey.isPrincipal ? ctx.user.id : undefined;
    const cards: SessionCard[] = [];
    for (const subjectId of subjects) {
      const slots = slotsForBatch({ batch, institute: ctx.institute, date: this.today(ctx), config: ctx.config, timetable: ctx.data.timetable, subjectId, instructorId });
      for (const scheduled of slots) cards.push(await this.card(ctx, batch, scheduled, subjectId, blocks));
    }
    return cards;
  }

  /** Batches of one trade (trade picker, trade switcher, group-instructor and principal views). */
  async boardForTrade(ctx: SessionContext, tradeId: string): Promise<SessionCard[]> {
    const batches = ctx.data.batches.filter((b) => b.tradeId === tradeId && (ctx.journey.isPrincipal || ctx.access.batchIds.has(b.id) || ctx.access.tradeWideViewTradeId === tradeId));
    const blocks = await this.selfFirstBlocks(ctx);
    const cards = await Promise.all(batches.map((b) => this.batchCards(ctx, b.id, blocks)));
    return cards.flat();
  }

  /** A fixed list of the user's batches, grouped by trade (batch_list selection). */
  async myBoard(ctx: SessionContext): Promise<BatchGroup[]> {
    const groups: BatchGroup[] = [];
    const blocks = await this.selfFirstBlocks(ctx);
    for (const tradeId of ctx.access.tradeIds) {
      const trade = ctx.data.trades.find((t) => t.id === tradeId);
      if (!trade) continue;
      const batches = ctx.data.batches.filter((b) => b.tradeId === tradeId && ctx.access.batchIds.has(b.id));
      const cards = (await Promise.all(batches.map((b) => this.batchCards(ctx, b.id, blocks)))).flat();
      if (cards.length) groups.push({ trade, cards });
    }
    return groups;
  }

  /** Today's timetabled periods for this instructor, in time order (timetable selection). */
  async timetableBoard(ctx: SessionContext): Promise<SessionCard[]> {
    const cards: SessionCard[] = [];
    const blocks = await this.selfFirstBlocks(ctx);
    for (const entry of ctx.access.timetable) {
      const batch = ctx.data.batches.find((b) => b.id === entry.batchId);
      if (!batch) continue;
      const scheduled: ScheduledSlot = { slot: { kind: 'period', periodNo: entry.periodNo }, window: ctx.config.time.fencing ? entry.window : null, timetableEntry: entry };
      cards.push(await this.card(ctx, batch, scheduled, entry.subjectId, blocks));
    }
    return cards;
  }

  async submittedTodayBy(ctx: SessionContext, staffId: string): Promise<SessionCard[]> {
    const today = this.today(ctx);
    const subs = (await this.deps.attendance.listSubmissions({ from: today, to: today })).filter((s) => s.markedBy === staffId);
    const cards = await Promise.all(subs.map((s) => this.findCard(ctx, s.sessionKey)));
    return cards.filter((c): c is SessionCard => Boolean(c)).sort((a, b) => (b.submission?.at ?? '').localeCompare(a.submission?.at ?? ''));
  }

  /** Resolves a session key (from a URL) back to its card, for any date. */
  async findCard(ctx: SessionContext, key: SessionKey): Promise<SessionCard | undefined> {
    const address = parseSessionKey(key);
    const batch = address && ctx.data.batches.find((b) => b.id === address.batchId);
    if (!address || !batch) return undefined;
    if (address.date === this.today(ctx)) {
      const cards = await this.cardsForBatch(ctx, batch.id);
      return cards.find((c) => c.key === key);
    }
    // Past days are read-only: build the card from the stored record.
    const submission = await this.deps.attendance.getSubmission(key);
    if (!submission) return undefined;
    return {
      key,
      address,
      batch,
      trade: this.trade(ctx, batch),
      scheduled: { slot: address.slot, window: null },
      status: 'submitted',
      studentCount: ctx.data.students.filter((s) => s.batchId === batch.id).length,
      submission: await this.summarize(ctx, submission),
      canMark: false,
      ...(await this.packInfo(batch.id)),
    };
  }

  async getDetail(ctx: SessionContext, key: SessionKey): Promise<SessionDetail | undefined> {
    const card = await this.findCard(ctx, key);
    if (!card) return undefined;
    const students = ctx.data.students.filter((s) => s.batchId === card.batch.id);
    const submission = await this.deps.attendance.getSubmission(key);
    const corrections: Correction[] = submission ? await this.deps.corrections.listForAttendance([submission.id]) : [];
    return {
      card,
      students,
      submission,
      marks: submission ? effectiveMarks(submission, corrections) : {},
      correctedStudentIds: new Set(corrections.map((c) => c.studentId)),
    };
  }

  /** Leave marked earlier with an "until" date pre-fills later days as a suggestion (PRD §9.5). */
  private async carriedLeave(ctx: SessionContext, batchId: string, slot: SessionAddress['slot']): Promise<Record<string, Mark>> {
    if (!ctx.journey.marking.leaveDateRange) return {};
    const today = this.today(ctx);
    const past = await this.deps.attendance.listSubmissions({ batchIds: [batchId], from: addDays(today, -30), to: addDays(today, -1) });
    const carried: Record<string, Mark> = {};
    for (const sub of past.filter((s) => sameSlot(s.address.slot, slot)).sort((a, b) => a.address.date.localeCompare(b.address.date))) {
      for (const [studentId, mark] of Object.entries(sub.marks)) {
        if (mark.status === 'leave' && mark.leaveUntil && compareDates(mark.leaveUntil, today) >= 0) carried[studentId] = mark;
      }
    }
    return carried;
  }

  private verificationPurpose = (key: SessionKey) => `session:${key}`;

  async openRoster(ctx: SessionContext, key: SessionKey): Promise<Result<RosterData, OpenRosterError>> {
    const card = await this.findCard(ctx, key);
    if (!card) return err('unknown_session');
    if (card.address.date !== this.today(ctx)) return err('not_today');
    if (card.status === 'submitted') return err('already_submitted');
    if (card.status === 'future') return err('window_not_open');
    if (card.status === 'closed') return err('window_closed');
    if (!card.canMark) return err('no_access');
    if (card.selfFirst) return err('self_first');
    const packs = await this.deps.packs.list();
    const pack = packs.find((p) => p.batchId === card.batch.id);
    if (!this.deps.isOnline()) {
      // offline.enabled = false: marking needs a connection, whatever is cached on the phone.
      if (!ctx.config.offline.enabled) return err('needs_connection');
      if (!pack) return err('not_downloaded');
    }
    // INV-16: the list is served only after verification passed for this session today.
    if (ctx.journey.verification.required) {
      const pass = await this.deps.verification.find(ctx.user.id, this.verificationPurpose(key), this.today(ctx));
      if (!pass) return err('not_verified');
    }
    const students = ctx.data.students.filter((s) => s.batchId === card.batch.id);
    const draft = await this.deps.attendance.getDraft(key);
    const fresh = initialMarks(students, {
      marking: ctx.config.marking,
      date: this.today(ctx),
      ojt: ctx.data.ojt,
      carriedLeave: await this.carriedLeave(ctx, card.batch.id, card.address.slot),
    });
    // A draft survives reloads; rows no longer valid under the current configuration fall back to the default.
    const marks: Record<string, Mark> = {};
    const sources: Record<string, MarkSource> = {};
    for (const s of students) {
      const saved = draft?.marks[s.id];
      const keep = saved && (saved.status === null || isMarkAllowed(saved, ctx.config.marking)) && fresh[s.id].status !== 'ojt';
      marks[s.id] = keep ? saved : fresh[s.id];
      const source = keep ? draft?.sources?.[s.id] : undefined;
      if (source) sources[s.id] = source;
    }
    return ok({ card, students, marks, sources, packStale: Boolean(pack && !this.deps.isOnline() && this.deps.isPackStale(pack.downloadedAt)), packDownloadedAt: pack?.downloadedAt });
  }

  /**
   * Writes a device draft of `marks` directly. Only tests call it: the screens and voice save through
   * MarkingDraftService, which records who made each mark. It keeps the stored draft's source wherever that
   * student's mark is unchanged (a voice or tap mark stays the trainer's); a changed mark has no known source.
   */
  async saveDraft(ctx: SessionContext, key: SessionKey, marks: Readonly<Record<string, Mark>>): Promise<void> {
    const stored = await this.deps.attendance.getDraft(key);
    const sources: Record<string, MarkSource> = {};
    for (const [id, source] of Object.entries(stored?.sources ?? {})) {
      const before = stored?.marks[id];
      if (before && marks[id] && marksEqual(before, marks[id])) sources[id] = source;
    }
    await this.deps.attendance.saveDraft({ sessionKey: key, marks, sources, updatedAt: ctx.clock.now().toISOString() });
  }

  async submit(ctx: SessionContext, key: SessionKey, marks: Readonly<Record<string, Mark>>): Promise<Result<AttendanceSubmission, SubmitError | 'unknown_session'>> {
    const card = await this.findCard(ctx, key);
    if (!card) return err('unknown_session');
    const today = this.today(ctx);
    const pass = ctx.journey.verification.required
      ? await this.deps.verification.find(ctx.user.id, this.verificationPurpose(key), today)
      : undefined;
    const check = checkSubmission({
      address: card.address,
      today,
      existing: await this.deps.attendance.getSubmission(key),
      windowState: card.status === 'submitted' ? 'open' : card.status,
      hasAccess: ctx.journey.isPrincipal ? ctx.journey.principalCanMarkStudents : canMarkBatch(ctx.access, card.batch.id),
      verificationRequired: ctx.journey.verification.required,
      verified: Boolean(pass),
      marks,
      rosterIds: ctx.data.students.filter((s) => s.batchId === card.batch.id).map((s) => s.id),
      config: ctx.config,
      // The card already carries the answer from this call's one read of the own record (D-152). A card it blocks is
      // open and markable; a blocked one that is not is refused above, by the window, access or submit-once checks.
      selfFirst: { required: Boolean(card.selfFirst), ownRecordToday: undefined },
    });
    if (!check.ok) return check;
    await this.deps.delay?.(500);
    const submission: AttendanceSubmission = {
      id: createId('att'),
      sessionKey: key,
      address: card.address,
      marks: { ...marks },
      markedBy: ctx.user.id,
      deviceTimestamp: ctx.clock.now().toISOString(),
      ...(pass?.location ? { location: pass.location } : {}),
      syncState: 'pending',
    };
    const created = await this.deps.attendance.createSubmission(submission);
    if (!created.ok) return created;
    await this.deps.attendance.deleteDraft(key);
    await this.deps.offlineQueue.enqueue({
      id: createId('q'),
      kind: 'attendance_submission',
      recordId: submission.id,
      label: key,
      enqueuedAt: submission.deviceTimestamp,
      attempts: 0,
    });
    this.deps.onRecordQueued();
    return ok(submission);
  }
}
