/**
 * Voice minutes and face-enrolment flags on Supabase. Both are also kept on the device, so the daily voice cap
 * and an offline enrolment keep working without the server (Task 17: an offline enrolment is sent on reconnect).
 */
import type { FaceEnrolment } from '@/domain/device';
import type { LocalDate } from '@/lib/time';
import type { FaceEnrolmentRepository, VoiceUsageRepository } from '../interfaces';
import { MockFaceEnrolmentRepository, MockVoiceUsageRepository } from '../mock/repositories';
import { eq } from './data-client';
import { scoped, selectMapped, type SupabaseContext } from './context';
import { faceToRow, rowToFace } from './mappers';

export const FACE_CACHE = 'face:';
/** Staff ids whose enrolment flag has not reached the server yet. */
const FACE_OUTBOX = 'outbox:face';

/** Seconds per trainer per IST day (D-089). The server total counts every device; the device total is the floor. */
export class SupabaseVoiceUsageRepository implements VoiceUsageRepository {
  private readonly device: MockVoiceUsageRepository;

  constructor(private readonly ctx: SupabaseContext) {
    this.device = new MockVoiceUsageRepository(ctx.db);
  }

  private async serverSeconds(staffId: string, date: LocalDate): Promise<number | undefined> {
    const result = await this.ctx.client.select({ table: 'voice_usage', order: 'staff_id', filters: [eq('staff_id', staffId), eq('date', date)] });
    if (!result.ok) return undefined;
    return result.data.length ? Number(result.data[0].seconds) : 0;
  }

  async get(staffId: string, date: LocalDate) {
    const mine = await this.device.get(staffId, date);
    const server = await this.serverSeconds(staffId, date);
    return server === undefined ? mine : Math.max(server, mine);
  }

  async add(staffId: string, date: LocalDate, seconds: number) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    await this.device.add(staffId, date, seconds);
    const server = await this.serverSeconds(staffId, date);
    if (server === undefined) return; // offline: counted on the device; the next online add catches the server up
    const total = Math.max(server + seconds, await this.device.get(staffId, date));
    await this.ctx.client.upsert('voice_usage', { staff_id: staffId, date, seconds: total }, 'staff_id,date');
  }
}

/**
 * SIMULATION ONLY: the flag that enrolment happened, never an image or template (D-048). Saved on the device first
 * (kept across a day change), then upserted; an upsert that did not reach the server waits in a small outbox and is
 * sent again on reconnect (`flush`, wired by the container). A live read prefers the server: a device copy the server
 * does not have, and that is not waiting to be sent, was removed elsewhere (or by a shared reset) and is dropped.
 */
export class SupabaseFaceEnrolmentRepository implements FaceEnrolmentRepository {
  private readonly device: MockFaceEnrolmentRepository;

  constructor(private readonly ctx: SupabaseContext) {
    this.device = new MockFaceEnrolmentRepository(ctx.db);
  }

  async get(staffId: string) {
    const read = await this.ctx.cache.readLive(
      `${FACE_CACHE}${staffId}`,
      () => selectMapped(this.ctx.client, { table: 'face_enrolment', order: 'staff_id', filters: [eq('staff_id', staffId)] }, rowToFace),
      [] as FaceEnrolment[],
    );
    const server = read.value[0];
    if (server || !read.live) return server ?? (await this.device.get(staffId));
    if (this.waiting().includes(staffId)) return this.device.get(staffId);
    if (this.ctx.db.read('face')[staffId]) await this.device.remove(staffId);
    return undefined;
  }

  async save(enrolment: FaceEnrolment) {
    await this.device.save(enrolment);
    this.setWaiting([...this.waiting().filter((id) => id !== enrolment.staffId), enrolment.staffId]);
    await this.send(enrolment);
  }

  /** Sends the enrolments saved while the server could not be reached. */
  async flush(): Promise<void> {
    for (const staffId of this.waiting()) {
      const enrolment = await this.device.get(staffId);
      if (!enrolment) this.setWaiting(this.waiting().filter((id) => id !== staffId));
      else if (!(await this.send(enrolment))) return;
    }
  }

  /** One upsert; true when the server has the flag (then it no longer waits). */
  private async send(enrolment: FaceEnrolment): Promise<boolean> {
    const result = await this.ctx.client.upsert('face_enrolment', faceToRow(enrolment), 'staff_id', { ignoreDuplicates: true });
    this.ctx.cache.invalidate(FACE_CACHE);
    if (!result.ok) return false;
    this.setWaiting(this.waiting().filter((id) => id !== enrolment.staffId));
    return true;
  }

  private waiting(): string[] {
    return this.ctx.store.get<string[]>(FACE_OUTBOX) ?? [];
  }

  private setWaiting(staffIds: readonly string[]): void {
    try {
      this.ctx.store.set(FACE_OUTBOX, staffIds);
    } catch {
      // Device storage is full: the flag is still on the device; the next save tries again.
    }
  }

  /**
   * The server row first (anon may delete face enrolments, D-144), then the device copy, only once the server's is gone:
   * a delete that fails (offline, refused) keeps both, so this device never disagrees with the shared copy.
   */
  async remove(staffId: string) {
    const removed = await this.ctx.client.remove('face_enrolment', [eq('staff_id', staffId)]);
    if (!removed.ok) return;
    this.ctx.cache.invalidate(FACE_CACHE);
    this.setWaiting(this.waiting().filter((id) => id !== staffId));
    await this.device.remove(staffId);
    this.ctx.bus.emit('face');
  }

  /** Server flags plus this device's waiting ones; the other device copies count only while the server cannot be read. */
  async count() {
    const scope = scoped(this.ctx);
    const read = await this.ctx.cache.readLive(
      `${FACE_CACHE}all:${scope.key}`,
      () => selectMapped(this.ctx.client, { table: 'face_enrolment', order: 'staff_id', filters: scope.filters }, rowToFace),
      [] as FaceEnrolment[],
    );
    const onDevice = Object.keys(this.ctx.db.read('face'));
    const waiting = new Set(this.waiting());
    const local = read.live ? onDevice.filter((id) => waiting.has(id)) : onDevice;
    return new Set([...read.value.map((f) => f.staffId), ...local]).size;
  }
}
