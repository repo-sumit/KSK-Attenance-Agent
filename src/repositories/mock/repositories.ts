/**
 * Mock repository implementations. They behave like the future API would —
 * async, write-once where the domain demands it, append-only audit log — so the
 * rest of the app cannot tell them apart from real ones.
 */
import { parseSessionKey, type AttendanceSubmission, type Correction, type StaffAttendanceRecord, type SyncState } from '@/domain/attendance';
import type { InstituteId, MasterData } from '@/domain/entities';
import { buildMasterData } from '@/data/mock/seeds';
import { historicalStaffRecord, historicalSubmission, HISTORY_BATCH_IDS, subjectsWithHistory } from '@/data/mock/history';
import { err, ok } from '@/lib/result';
import { compareDates, eachDate, type LocalDate } from '@/lib/time';
import type {
  AttendanceRepository,
  BatchPackRepository,
  CorrectionRepository,
  FaceEnrolmentRepository,
  MasterDataRepository,
  OfflineQueueRepository,
  PreferencesRepository,
  SessionRepository,
  StaffAttendanceRepository,
  SubmissionQuery,
  VerificationRepository,
  VoiceUsageRepository,
} from '../interfaces';
import { MockDatabase, staffKey, voiceUsageKey } from './database';
import type { EventBus } from '@/lib/events';
import type { KeyValueStore } from '@/lib/kv-store';
import type { Language } from '@/config/types';

/** Simulated network latency for lookups, so "Checking…" states are real. Zero in tests. */
export type Delay = (ms: number) => Promise<void>;

export class MockMasterDataRepository implements MasterDataRepository {
  private cache: { date: LocalDate; data: MasterData } | undefined;

  constructor(private readonly db: MockDatabase, private readonly delay: Delay) {}

  private all(): MasterData {
    const today = this.db.today();
    if (!this.cache || this.cache.date !== today) this.cache = { date: today, data: buildMasterData(today) };
    return this.cache.data;
  }

  async findInstituteByCode(code: string) {
    await this.delay(450);
    return this.all().institutes.find((i) => i.code === code.trim());
  }

  async findStaffByTrainerId(instituteId: InstituteId, trainerId: string) {
    await this.delay(450);
    const id = trainerId.trim().toUpperCase();
    return this.all().staff.find((s) => s.instituteId === instituteId && s.trainerId === id);
  }

  async getBatchRoster(instituteId: InstituteId, batchId: string) {
    const all = this.all();
    const batch = all.batches.find((b) => b.id === batchId && all.trades.some((t) => t.id === b.tradeId && t.instituteId === instituteId));
    return batch ? all.students.filter((s) => s.batchId === batch.id) : [];
  }

  async getInstituteData(instituteId: InstituteId): Promise<MasterData> {
    const all = this.all();
    const trades = all.trades.filter((t) => t.instituteId === instituteId);
    const tradeIds = new Set(trades.map((t) => t.id));
    const batches = all.batches.filter((b) => tradeIds.has(b.tradeId));
    const batchIds = new Set(batches.map((b) => b.id));
    const studentIds = new Set(all.students.filter((s) => batchIds.has(s.batchId)).map((s) => s.id));
    return {
      institutes: all.institutes.filter((i) => i.id === instituteId),
      trades,
      subjects: all.subjects,
      batches,
      students: all.students.filter((s) => batchIds.has(s.batchId)),
      staff: all.staff.filter((s) => s.instituteId === instituteId),
      timetable: all.timetable.filter((t) => batchIds.has(t.batchId)),
      ojt: all.ojt.filter((o) => o.studentIds.some((id) => studentIds.has(id))),
    };
  }
}

export class MockAttendanceRepository implements AttendanceRepository {
  constructor(private readonly db: MockDatabase) {}

  /** Past daily records (and subject sessions) come from generated history; anything else from the store. */
  private historical(batchId: string, date: LocalDate, subjectId?: string): AttendanceSubmission | undefined {
    return historicalSubmission(batchId, date, this.db.today(), subjectId);
  }

  async getSubmission(sessionKey: string) {
    const stored = this.db.read('submissions')[sessionKey];
    if (stored) return stored;
    const address = parseSessionKey(sessionKey);
    if (!address || address.slot.kind !== 'daily') return undefined;
    return compareDates(address.date, this.db.today()) < 0 ? this.historical(address.batchId, address.date, address.subjectId) : undefined;
  }

  async getSubmissionById(id: string) {
    const stored = Object.values(this.db.read('submissions')).find((s) => s.id === id);
    if (stored) return stored;
    const m = /^hist-(?:([^~]+)~)?(.+)-(\d{4}-\d{2}-\d{2})$/.exec(id);
    return m ? this.historical(m[2], m[3], m[1]) : undefined;
  }

  async listSubmissions(query: SubmissionQuery) {
    const wanted = query.batchIds ? new Set(query.batchIds) : undefined;
    const inRange = (d: LocalDate) => compareDates(query.from, d) <= 0 && compareDates(d, query.to) <= 0;
    const stored = Object.values(this.db.read('submissions')).filter(
      (s) => inRange(s.address.date) && (!wanted || wanted.has(s.address.batchId)),
    );
    const today = this.db.today();
    const history: AttendanceSubmission[] = [];
    for (const date of eachDate(query.from, query.to)) {
      if (compareDates(date, today) >= 0) break;
      for (const batchId of query.batchIds ?? HISTORY_BATCH_IDS) {
        for (const subjectId of [undefined, ...subjectsWithHistory(batchId).map((h) => h.subjectId)]) {
          const h = this.historical(batchId, date, subjectId);
          if (h && !stored.some((s) => s.sessionKey === h.sessionKey)) history.push(h);
        }
      }
    }
    return [...stored, ...history];
  }

  async createSubmission(submission: AttendanceSubmission) {
    // Check-and-set inside one synchronous update, so two quick taps can never both write (INV-01).
    let conflict = false;
    this.db.update(
      'submissions',
      (all) => {
        if (all[submission.sessionKey]) {
          conflict = true;
          return all;
        }
        return { ...all, [submission.sessionKey]: Object.freeze(submission) };
      },
      'attendance',
    );
    return conflict ? err('already_submitted') : ok(submission);
  }

  async markSubmissionSynced(id: string, serverTimestamp: string) {
    this.db.update(
      'submissions',
      (all) => {
        const entry = Object.entries(all).find(([, s]) => s.id === id);
        if (!entry) return all;
        return { ...all, [entry[0]]: { ...entry[1], syncState: 'synced', serverTimestamp } };
      },
      'attendance',
    );
  }

  async markSubmissionRejected(id: string) {
    this.db.update(
      'submissions',
      (all) => {
        const entry = Object.entries(all).find(([, s]) => s.id === id);
        return entry ? { ...all, [entry[0]]: { ...entry[1], syncState: 'rejected' } } : all;
      },
      'attendance',
    );
  }

  async getDraft(sessionKey: string) {
    return this.db.read('drafts')[sessionKey];
  }
  async saveDraft(draft: Parameters<AttendanceRepository['saveDraft']>[0]) {
    // A locked session never gets a draft again.
    if (this.db.read('submissions')[draft.sessionKey]) return;
    this.db.update('drafts', (all) => ({ ...all, [draft.sessionKey]: draft }));
  }
  async deleteDraft(sessionKey: string) {
    this.db.update('drafts', (all) => {
      const next = { ...all };
      delete next[sessionKey];
      return next;
    });
  }
}

export class MockCorrectionRepository implements CorrectionRepository {
  constructor(private readonly db: MockDatabase) {}

  async append(correction: Correction) {
    this.db.update('corrections', (all) => [...all, Object.freeze({ ...correction })], 'corrections', 'attendance');
  }
  async listForAttendance(attendanceIds: readonly string[]) {
    const ids = new Set(attendanceIds);
    return this.db.read('corrections').filter((c) => ids.has(c.attendanceId)).map((c) => ({ ...c }));
  }
  async listBetween(from: LocalDate, to: LocalDate) {
    return this.db
      .read('corrections')
      .filter((c) => {
        const day = c.timestamp.slice(0, 10);
        return compareDates(from, day) <= 0 && compareDates(day, to) <= 0;
      })
      .map((c) => ({ ...c }));
  }
}

export class MockStaffAttendanceRepository implements StaffAttendanceRepository {
  constructor(private readonly db: MockDatabase) {}

  async get(staffId: string, date: LocalDate) {
    return this.db.read('staff')[staffKey(staffId, date)] ?? historicalStaffRecord(staffId, date, this.db.today());
  }
  async getById(id: string) {
    return Object.values(this.db.read('staff')).find((r) => r.id === id);
  }
  async listForDate(date: LocalDate) {
    return Object.values(this.db.read('staff')).filter((r) => r.date === date);
  }
  async listBetween(staffIds: readonly string[], from: LocalDate, to: LocalDate) {
    const out: StaffAttendanceRecord[] = [];
    for (const date of eachDate(from, to)) {
      for (const id of staffIds) {
        const r = await this.get(id, date);
        if (r) out.push(r);
      }
    }
    return out;
  }
  async create(record: StaffAttendanceRecord) {
    let conflict = false;
    const key = staffKey(record.staffId, record.date);
    this.db.update(
      'staff',
      (all) => {
        if (all[key]) {
          conflict = true;
          return all;
        }
        return { ...all, [key]: Object.freeze(record) };
      },
      'staff',
    );
    return conflict ? err('already_marked') : ok(record);
  }
  async markSynced(id: string) {
    this.setSyncState(id, 'synced');
  }
  async markRejected(id: string) {
    this.setSyncState(id, 'rejected');
  }
  private setSyncState(id: string, syncState: SyncState) {
    this.db.update(
      'staff',
      (all) => {
        const entry = Object.entries(all).find(([, r]) => r.id === id);
        return entry ? { ...all, [entry[0]]: { ...entry[1], syncState } } : all;
      },
      'staff',
    );
  }
}

export class MockFaceEnrolmentRepository implements FaceEnrolmentRepository {
  constructor(private readonly db: MockDatabase) {}
  async get(staffId: string) {
    return this.db.read('face')[staffId];
  }
  async save(enrolment: Parameters<FaceEnrolmentRepository['save']>[0]) {
    this.db.update('face', (all) => ({ ...all, [enrolment.staffId]: enrolment }), 'face');
  }
  async remove(staffId: string) {
    this.db.update(
      'face',
      (all) => {
        const next = { ...all };
        delete next[staffId];
        return next;
      },
      'face',
    );
  }
  async count() {
    return Object.keys(this.db.read('face')).length;
  }
}

export class MockVerificationRepository implements VerificationRepository {
  constructor(private readonly db: MockDatabase) {}
  private key = (staffId: string, purpose: string, date: LocalDate) => `${staffId}|${purpose}|${date}`;
  async grant(pass: Parameters<VerificationRepository['grant']>[0]) {
    this.db.update('passes', (all) => ({ ...all, [this.key(pass.staffId, pass.purpose, pass.date)]: pass }), 'verification');
  }
  async find(staffId: string, purpose: string, date: LocalDate) {
    return this.db.read('passes')[this.key(staffId, purpose, date)];
  }
}

export class MockOfflineQueueRepository implements OfflineQueueRepository {
  constructor(private readonly db: MockDatabase) {}
  async list() {
    return [...this.db.read('queue')];
  }
  async enqueue(item: Parameters<OfflineQueueRepository['enqueue']>[0]) {
    this.db.update('queue', (all) => [...all, item], 'offline');
  }
  async update(item: Parameters<OfflineQueueRepository['update']>[0]) {
    this.db.update('queue', (all) => all.map((q) => (q.id === item.id ? item : q)), 'offline');
  }
  async remove(ids: readonly string[]) {
    const doomed = new Set(ids);
    this.db.update('queue', (all) => all.filter((q) => !doomed.has(q.id)), 'offline');
  }
}

export class MockBatchPackRepository implements BatchPackRepository {
  constructor(private readonly db: MockDatabase) {}
  async list() {
    return Object.values(this.db.read('packs'));
  }
  async upsert(packs: Parameters<BatchPackRepository['upsert']>[0]) {
    this.db.update('packs', (all) => ({ ...all, ...Object.fromEntries(packs.map((p) => [p.batchId, p])) }), 'packs');
  }
}

export class MockSessionRepository implements SessionRepository {
  constructor(private readonly db: MockDatabase) {}
  async get() {
    return this.db.read('session') ?? undefined;
  }
  async set(session: Parameters<SessionRepository['set']>[0]) {
    this.db.write('session', session, 'session');
  }
  async clear() {
    this.db.write('session', null, 'session');
  }
}

/** Voice seconds per trainer per IST day. Written without a bus topic: nothing on screen lists it. */
export class MockVoiceUsageRepository implements VoiceUsageRepository {
  constructor(private readonly db: MockDatabase) {}
  async get(staffId: string, date: LocalDate) {
    return this.db.read('voiceUsage')[voiceUsageKey(staffId, date)] ?? 0;
  }
  async add(staffId: string, date: LocalDate, seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const key = voiceUsageKey(staffId, date);
    this.db.update('voiceUsage', (all) => ({ ...all, [key]: (all[key] ?? 0) + seconds }));
  }
}

/**
 * Device-level preference (not mock data): kept in its own store so it
 * survives a data reseed and works the same once repositories are API-backed.
 */
export class DevicePreferencesRepository implements PreferencesRepository {
  constructor(private readonly store: KeyValueStore, private readonly bus: EventBus) {}
  async getLanguage() {
    return this.store.get<Language>('language');
  }
  async setLanguage(language: Language) {
    this.store.set('language', language);
    this.bus.emit('preferences');
  }
}
