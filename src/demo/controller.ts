/**
 * DEMO ONLY. Everything the presenter can do, expressed through the same
 * interfaces the app already uses (auth, config overrides, simulation, clock).
 */
import { dataSourceEnv, resolveDataSource } from '@/app-shell/data-source';
import { mergeConfigLayer } from '@/config/resolve';
import type { ConfigLayer, Language } from '@/config/types';
import { awaitsSync, toSessionKey } from '@/domain/attendance';
import { initialMarks } from '@/domain/marking';
import { createId } from '@/lib/ids';
import { toLocalDate, type LocalTime } from '@/lib/time';
import type { AppContainer } from '@/services/container';
import type { SimulationState } from '@/services/simulation';
import type { DemoAdapters } from './adapters';
import { personaById, type PersonaId } from './personas';
import { PRESETS, type DemoPreset } from './presets';
import { applyPresetState, DEFAULT_DEMO_STATE, type DataChoice } from './state';
import { resetSharedDemo, type ResetOutcome } from './supabase-seeder';
import { createVoicePuppet, type VoicePuppet } from './voice-puppet';

export type NetworkMode = 'online' | 'offline' | 'pending';

/** What a Data switch did: nothing to change, switched (the page reloads), or refused while records wait to sync. */
export type DataSwitch = { readonly kind: 'unchanged' } | { readonly kind: 'switched' } | { readonly kind: 'waiting'; readonly count: number };
const INSTITUTE_ID = 'inst-27410';

/**
 * The demo's face flag for one person, through the repository so it reaches the shared copy on the Supabase source
 * (the First-time story must hide an enrolment another device made). On the device source it is the same synchronous
 * write as before (the mock repository's body runs before its first await).
 */
async function setFace(app: AppContainer, staffId: string, enrolled: boolean): Promise<void> {
  if (enrolled) await app.repositories.faceEnrolment.save({ staffId, enrolledAt: app.clock.now().toISOString(), sampleCount: 3, simulated: true });
  else await app.repositories.faceEnrolment.remove(staffId);
}

/**
 * A preset's story without moving anyone: who is demonstrated, the
 * configuration, fresh simulated outcomes, the demo clock and face enrolment.
 * It signs nobody in or out and navigates nowhere. Shared by the panel's
 * presets and by "Demo accounts" on the login screen (through the
 * LoginAssistSource seam, wired in boot.ts). The state changes happen at once;
 * the promise settles when the face flag has reached the server too. On the
 * Supabase source it also writes the story's packs (the Offline story needs
 * its downloaded and stale batches), as the device source has them.
 */
export async function prepareScenario(app: AppContainer, demo: DemoAdapters, presetId: string): Promise<DemoPreset | null> {
  const preset = PRESETS.find((p) => p.id === presetId);
  if (!preset) return null;
  const persona = personaById(preset.persona);
  demo.repo.update((s) => applyPresetState(s, preset));
  app.mockDatabase.clearPasses();
  app.mockDatabase.restoreStoryPacks();
  await setFace(app, persona.staffId, !preset.firstTime);
  return preset;
}

export interface DemoControllerOptions {
  /** Starts the page afresh (Reset, a Data switch). Tests pass their own. */
  readonly reload?: () => void;
  /** Whether the build has a Supabase project to share (the Data switch is offered only then). */
  readonly sharedAvailable?: boolean;
}

export class DemoController {
  /** `window.__kskDemo.voice`: plays the scripted voice model's side (E2E, demos without a microphone). */
  readonly voice: VoicePuppet;
  /** The Data row offers "Shared (Supabase)" only when the build is configured for it. */
  readonly sharedAvailable: boolean;
  private readonly reload: () => void;

  constructor(
    private readonly app: AppContainer,
    private readonly demo: DemoAdapters,
    private readonly navigate: (href: string) => void,
    options: DemoControllerOptions = {},
  ) {
    this.voice = createVoicePuppet(app.services.voice);
    this.sharedAvailable = options.sharedAvailable ?? resolveDataSource(dataSourceEnv()) === 'supabase';
    this.reload = options.reload ?? (() => window.location.replace('/'));
  }

  private now() {
    return this.app.clock.now();
  }

  /** Live configuration change = a new session start (PRD §5.2): passes are revoked, the session re-resolves. */
  setConfig(patch: ConfigLayer): void {
    this.demo.repo.update((s) => ({ ...s, presetId: null, config: mergeConfigLayer<ConfigLayer>(s.config, patch) }));
    this.app.mockDatabase.clearPasses();
  }

  setSimulation(patch: Partial<SimulationState>): void {
    this.demo.repo.update((s) => ({ ...s, simulation: { ...s.simulation, ...patch } }));
  }

  setClock(time: LocalTime | 'real'): void {
    this.demo.repo.update((s) => ({ ...s, clock: time === 'real' ? { mode: 'real' } : { mode: 'fixed', time } }));
  }

  async setLanguage(language: Language): Promise<void> {
    await this.app.repositories.preferences.setLanguage(language);
  }

  async setFaceEnrolled(enrolled: boolean): Promise<void> {
    const session = await this.app.repositories.session.get();
    if (session) await setFace(this.app, session.staffId, enrolled);
  }

  /** Straight into the persona's session with the current story (E2E helpers; the panel's Sign in as uses applyPreset). */
  async signInAs(personaId: PersonaId, go = true): Promise<void> {
    const persona = personaById(personaId);
    // The persona brings its own mapping; drop any explicit mapping override from the panel.
    this.demo.repo.update((s) => ({ ...s, persona: persona.id, config: { ...s.config, mapping: undefined } }));
    this.app.mockDatabase.clearPasses();
    await this.app.services.auth.startSession(INSTITUTE_ID, persona.staffId);
    if (go) this.navigate('/home');
  }

  /**
   * "Show the login screens": signs out and opens the first login screen, where "Demo accounts" lists everyone. The
   * story and the persona picked last stay (that person is highlighted there).
   */
  async showLogin(): Promise<void> {
    this.app.mockDatabase.clearPasses();
    await this.app.services.auth.signOut();
    this.navigate('/login');
  }

  async setNetwork(mode: NetworkMode): Promise<void> {
    if (mode === 'pending') {
      // The Home "Sync pending" story (D-064): a record is waiting because an automatic attempt
      // failed; "Sync now" then works (unless the presenter chose Next sync: Fails).
      const fails = this.demo.repo.get().simulation.nextSyncFails;
      this.setConfig({ offline: { autoSync: false } });
      this.setSimulation({ online: true, nextSyncFails: true });
      // Only a record that can still sync tells the story; one the server refused for good does not count.
      if ((await this.app.services.sync.pendingItems()).every((item) => item.kind === 'correction')) await this.seedPendingRecord();
      await this.app.services.sync.syncNow('auto');
      this.setSimulation({ nextSyncFails: fails });
      return;
    }
    this.setConfig({ offline: { autoSync: true } });
    this.setSimulation({ online: mode === 'online' });
    if (mode === 'online') void this.app.services.sync.syncNow('auto'); // coming back online: what auto-sync does
  }

  /** Puts one locally locked, unsynced submission on the phone (for "Pending sync"). */
  private async seedPendingRecord(): Promise<void> {
    const ctx = await this.app.services.session.load();
    if (!ctx) return;
    const cards = (await Promise.all([...ctx.access.batchIds].map((id) => this.app.services.attendance.cardsForBatch(ctx, id)))).flat();
    const card = cards.find((c) => c.status === 'open') ?? cards.find((c) => c.status !== 'submitted');
    if (!card) return;
    const students = ctx.data.students.filter((s) => s.batchId === card.batch.id);
    const marks = initialMarks(students, { marking: ctx.config.marking, date: toLocalDate(this.now()), ojt: ctx.data.ojt, carriedLeave: {} });
    const at = this.now().toISOString();
    const submission = { id: createId('att'), sessionKey: toSessionKey(card.address), address: card.address, marks, markedBy: ctx.user.id, deviceTimestamp: at, syncState: 'pending' as const };
    await this.app.repositories.attendance.createSubmission(submission);
    await this.app.repositories.offlineQueue.enqueue({ id: createId('q'), kind: 'attendance_submission', recordId: submission.id, label: submission.sessionKey, enqueuedAt: at, attempts: 0 });
    this.app.services.sync.request();
  }

  async applyPreset(id: string): Promise<void> {
    const preset = await prepareScenario(this.app, this.demo, id);
    if (!preset) return;
    if (preset.start === 'login') {
      await this.app.services.auth.signOut();
      this.navigate('/login');
      return;
    }
    await this.app.services.auth.startSession(INSTITUTE_ID, personaById(preset.persona).staffId);
    this.navigate('/home');
  }

  /**
   * Where the data lives (the Data row). Stored in the demo state and applied by a reload; this device starts afresh.
   * Refused while this device holds records waiting to sync (Task 17 fix round 1): the other source would mark them
   * synced (or never send them), so they could never reach the shared copy. The panel says how many are waiting.
   */
  async setDataSource(choice: DataChoice): Promise<DataSwitch> {
    if (this.demo.repo.get().data === choice) return { kind: 'unchanged' };
    const waiting = await this.waitingToSync();
    if (waiting > 0) return { kind: 'waiting', count: waiting };
    this.demo.repo.update((s) => ({ ...s, data: choice }));
    this.reload();
    return { kind: 'switched' };
  }

  /** Records on this device not yet on the server: queued, still pending or failed, and corrections in the outbox. */
  private async waitingToSync(): Promise<number> {
    // Outbox corrections are listed too (D-153); they are counted once, below.
    const ids = new Set((await this.app.services.sync.pendingItems()).filter((item) => item.kind !== 'correction').map((item) => item.recordId));
    const db = this.app.mockDatabase;
    for (const record of [...Object.values(db.read('submissions')), ...Object.values(db.read('staff'))]) if (awaitsSync(record)) ids.add(record.id);
    return ids.size + this.app.services.sync.outboxCount();
  }

  /**
   * "Reset shared demo data": clears the demo institutes' records on the server for every device (ksk_reset_demo,
   * applied by the owner by hand), seeds today's story again, then resets this device. Anything but `done` leaves
   * everything as it was, for the panel to explain.
   */
  async resetShared(): Promise<ResetOutcome> {
    if (!this.app.serverClient) return 'unavailable';
    const outcome = await resetSharedDemo(this.app.serverClient, toLocalDate(this.now()));
    if (outcome === 'done') this.reset();
    return outcome;
  }

  /**
   * Complete by construction: wipe every namespace and reload from scratch. The presenter's Data choice is written
   * back after the wipe, so a presenter on "This device" stays there (the rest of the demo state starts afresh).
   */
  reset(): void {
    const data = this.demo.repo.get().data;
    // ksk-cache:v1: the Supabase source's cached server reads and correction outbox (D-143).
    for (const ns of ['ksk:v1:', 'ksk-demo:v1:', 'ksk-prefs:', 'ksk-cache:v1:']) {
      for (const key of Object.keys(window.localStorage)) if (key.startsWith(ns)) window.localStorage.removeItem(key);
    }
    this.demo.repo.update(() => ({ ...DEFAULT_DEMO_STATE, data }));
    this.reload();
  }
}
