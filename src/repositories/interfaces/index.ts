/**
 * Repository contracts — the data seam. Today every interface has a Mock*
 * implementation (repositories/mock) backed by a KeyValueStore; later an Api*
 * implementation (repositories/api) talks to the backend. Services and UI only
 * ever see these interfaces, so swapping implementations needs no UI change.
 *
 * All methods are async to match a network-backed future.
 */
import type {
  AttendanceDraft,
  AttendanceSubmission,
  Correction,
  OfflineQueueItem,
  SessionKey,
  StaffAttendanceRecord,
} from '@/domain/attendance';
import type { Announcement } from '@/domain/announcement';
import type { BatchPack, FaceEnrolment } from '@/domain/device';
import type { BatchId, Institute, InstituteId, MasterData, StaffId, StaffMember, Student } from '@/domain/entities';
import type { Language } from '@/config/types';
import type { PassChecks } from '@/domain/rules';
import type { Result } from '@/lib/result';
import type { LocalDate } from '@/lib/time';

export interface MasterDataRepository {
  findInstituteByCode(code: string): Promise<Institute | undefined>;
  /** Trainer IDs are scoped to the institute: an ID from another institute is "not found" (PRD §6.2). */
  findStaffByTrainerId(instituteId: InstituteId, trainerId: string): Promise<StaffMember | undefined>;
  /** Everything one institute needs — small enough to load once per session (PRD §4 scale notes). */
  getInstituteData(instituteId: InstituteId): Promise<MasterData>;
  /** One batch's current roster: what a pack download or refresh pulls (PRD §20.1, D-055). */
  getBatchRoster(instituteId: InstituteId, batchId: BatchId): Promise<readonly Student[]>;
}

export interface SubmissionQuery {
  readonly batchIds?: readonly string[];
  readonly from: LocalDate;
  readonly to: LocalDate;
}

export interface AttendanceRepository {
  getSubmission(sessionKey: SessionKey): Promise<AttendanceSubmission | undefined>;
  getSubmissionById(id: string): Promise<AttendanceSubmission | undefined>;
  listSubmissions(query: SubmissionQuery): Promise<AttendanceSubmission[]>;
  /** Write-once: a second submission for the same session key is refused here too (INV-01). */
  createSubmission(submission: AttendanceSubmission): Promise<Result<AttendanceSubmission, 'already_submitted'>>;
  markSubmissionSynced(id: string, serverTimestamp: string): Promise<void>;
  /** The server refused it for good (someone else submitted first): kept on the device, never pushed again. */
  markSubmissionRejected(id: string): Promise<void>;
  getDraft(sessionKey: SessionKey): Promise<AttendanceDraft | undefined>;
  saveDraft(draft: AttendanceDraft): Promise<void>;
  deleteDraft(sessionKey: SessionKey): Promise<void>;
}

/** Append-only audit log (PRD §12.4): there is deliberately no update or delete. */
export interface CorrectionRepository {
  append(correction: Correction): Promise<void>;
  listForAttendance(attendanceIds: readonly string[]): Promise<Correction[]>;
  listBetween(from: LocalDate, to: LocalDate): Promise<Correction[]>;
}

export interface StaffAttendanceRepository {
  get(staffId: StaffId, date: LocalDate): Promise<StaffAttendanceRecord | undefined>;
  getById(id: string): Promise<StaffAttendanceRecord | undefined>;
  listForDate(date: LocalDate): Promise<StaffAttendanceRecord[]>;
  listBetween(staffIds: readonly StaffId[], from: LocalDate, to: LocalDate): Promise<StaffAttendanceRecord[]>;
  /** One record per person per day (INV-22). */
  create(record: StaffAttendanceRecord): Promise<Result<StaffAttendanceRecord, 'already_marked'>>;
  markSynced(id: string): Promise<void>;
  /** The server refused it for good (another record for that person and day is there): kept, never pushed again. */
  markRejected(id: string): Promise<void>;
}

/** SIMULATION ONLY today: stores that enrolment happened, never an image or template. */
export interface FaceEnrolmentRepository {
  get(staffId: StaffId): Promise<FaceEnrolment | undefined>;
  save(enrolment: FaceEnrolment): Promise<void>;
  /** Removes the enrolment flag (the demo's "Face registered: No" and First-time user stories). */
  remove(staffId: StaffId): Promise<void>;
  count(): Promise<number>;
}

/** Proof that verification passed for one purpose (a session key, or self attendance) today. */
export interface VerificationPass {
  readonly staffId: StaffId;
  readonly purpose: string;
  readonly date: LocalDate;
  readonly grantedAt: string;
  readonly location?: { readonly lat: number; readonly lng: number; readonly accuracyM: number; readonly distanceM?: number };
  /** The checks this pass covered (D-152). A pass stored before this field existed is never reused for a batch. */
  readonly checks?: PassChecks;
}

export interface VerificationRepository {
  grant(pass: VerificationPass): Promise<void>;
  find(staffId: StaffId, purpose: string, date: LocalDate): Promise<VerificationPass | undefined>;
}

export interface OfflineQueueRepository {
  list(): Promise<OfflineQueueItem[]>;
  enqueue(item: OfflineQueueItem): Promise<void>;
  update(item: OfflineQueueItem): Promise<void>;
  remove(ids: readonly string[]): Promise<void>;
}

export interface BatchPackRepository {
  list(): Promise<BatchPack[]>;
  upsert(packs: readonly BatchPack[]): Promise<void>;
}

/** Notices posted for one institute (D-054). The server will target them; the service filters again per reader. */
export interface AnnouncementRepository {
  listForInstitute(instituteId: InstituteId): Promise<readonly Announcement[]>;
}

export interface StoredSession {
  readonly instituteId: InstituteId;
  readonly staffId: StaffId;
  readonly startedAt: string;
}

export interface SessionRepository {
  get(): Promise<StoredSession | undefined>;
  set(session: StoredSession): Promise<void>;
  clear(): Promise<void>;
}

export interface PreferencesRepository {
  getLanguage(): Promise<Language | undefined>;
  setLanguage(language: Language): Promise<void>;
}

/** Remote endpoint for pushing locally locked records (the "server" during sync). */
export interface SyncGateway {
  pushSubmission(submission: AttendanceSubmission): Promise<Result<{ serverTimestamp: string }, 'network' | 'rejected'>>;
  pushStaffRecord(record: StaffAttendanceRecord): Promise<Result<{ serverTimestamp: string }, 'network' | 'rejected'>>;
}

/** Voice minutes used per trainer per IST day (D-089 daily cap). */
export interface VoiceUsageRepository {
  /** Seconds of voice used by this staff member on this IST date. */
  get(staffId: string, date: LocalDate): Promise<number>;
  add(staffId: string, date: LocalDate, seconds: number): Promise<void>;
}

export interface Repositories {
  readonly masterData: MasterDataRepository;
  readonly attendance: AttendanceRepository;
  readonly corrections: CorrectionRepository;
  readonly staffAttendance: StaffAttendanceRepository;
  readonly faceEnrolment: FaceEnrolmentRepository;
  readonly verification: VerificationRepository;
  readonly offlineQueue: OfflineQueueRepository;
  readonly packs: BatchPackRepository;
  readonly announcements: AnnouncementRepository;
  readonly session: SessionRepository;
  readonly preferences: PreferencesRepository;
  readonly syncGateway: SyncGateway;
  readonly voiceUsage: VoiceUsageRepository;
}
