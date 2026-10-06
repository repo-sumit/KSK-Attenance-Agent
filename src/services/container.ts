/**
 * Composition root. Builds repositories and services for a data source.
 * `mock` wires the KeyValueStore-backed repositories and simulated providers.
 * `supabase` (D-143) puts the server-owned repositories on Supabase and keeps the
 * device-owned ones (drafts, queue, packs, passes, session, preferences) on the
 * device database; the services are the same for both.
 */
import { MAHARASHTRA } from '@/config/states/maharashtra';
import type { StateConfiguration } from '@/config/types';
import { isPackStale } from '@/domain/device';
import { EventBus } from '@/lib/events';
import type { KeyValueStore } from '@/lib/kv-store';
import type { Clock } from '@/lib/time';
import type { Repositories } from '@/repositories/interfaces';
import { MockDatabase } from '@/repositories/mock/database';
import { createSupabaseRepositories } from '@/repositories/supabase';
import type { DataClient } from '@/repositories/supabase/data-client';
import {
  MockAttendanceRepository,
  MockBatchPackRepository,
  MockCorrectionRepository,
  MockFaceEnrolmentRepository,
  MockMasterDataRepository,
  MockOfflineQueueRepository,
  DevicePreferencesRepository,
  MockSessionRepository,
  MockStaffAttendanceRepository,
  MockVerificationRepository,
  MockVoiceUsageRepository,
} from '@/repositories/mock/repositories';
import { MockAnnouncementRepository } from '@/repositories/mock/announcements';
import { AnnouncementService } from './announcements';
import { AttendanceService } from './attendance';
import { MockAuthService, type AuthService } from './auth';
import { ConfigurationService, type ConfigOverridesSource } from './configuration';
import { BrowserConnectivity, SimulatedConnectivity, type ConnectivityService } from './connectivity';
import { CorrectionService } from './corrections';
import { BasicClientLivenessService } from './camera/client-liveness';
import { CameraFaceCaptureService } from './camera/device-camera';
import { loadFaceDetector } from './camera/face-detector';
import { RoutedLiveness, SwitchableFaceCapture } from './camera/routing';
import type { FaceCaptureService, FaceMatchService, LivenessService } from './face';
import type { LoginAssistSource } from './login-assist';
import { MarkingDraftService } from './marking-draft';
import { BatchPackService } from './packs';
import { BrowserLocationProvider, type LocationProvider } from './location';
import { ReportService } from './reports';
import { SessionService } from './session';
import { MockFaceMatchService, SimulatedFaceCaptureService, SimulatedLivenessService } from './simulated/face';
import { SimulatedLocationProvider } from './simulated/location';
import { SimulatedSyncGateway } from './simulated/sync-gateway';
import { simulatedDelay, type SimulationSource } from './simulation';
import { StaffAttendanceService } from './staff-attendance';
import { SyncService, type SyncOutbox } from './sync';
import { VerificationService } from './verification';
import { Lifetime } from './lifetime';
import { ActionBus } from './voice/action-bus';
import { VoiceService } from './voice/service';

export interface Services {
  readonly auth: AuthService;
  readonly session: SessionService;
  readonly configuration: ConfigurationService;
  readonly attendance: AttendanceService;
  /** The live marking draft shared by the tap roster, review and voice (D-084). */
  readonly drafts: MarkingDraftService;
  readonly verification: VerificationService;
  /** The camera (real front camera, or the demo's simulated one). */
  readonly faceCapture: FaceCaptureService;
  /** Guides the steps and takes the photos: a prototype movement check, not production liveness. */
  readonly liveness: LivenessService;
  /** Enrolment + matching: SIMULATED in this build (MockFaceMatchService). */
  readonly faceMatch: FaceMatchService;
  readonly corrections: CorrectionService;
  readonly staffAttendance: StaffAttendanceService;
  readonly reports: ReportService;
  readonly sync: SyncService;
  readonly packs: BatchPackService;
  /** Institute / state notices for Home (D-054). */
  readonly announcements: AnnouncementService;
  readonly connectivity: ConnectivityService;
  /** Demo-only prefill for the login inputs; null in production (nothing renders). */
  readonly loginAssist: LoginAssistSource | null;
  /** Typed UI events from the voice executor to the screens (D-085). */
  readonly voiceBus: ActionBus;
  /** The one entry point for Voice Agent: plan, start, and the scripted demo driver (D-085). */
  readonly voice: VoiceService;
}

/** Where server-owned data lives: on this device (mock) or in the shared Supabase project (D-143). */
export type DataSource = 'mock' | 'supabase';

export interface AppContainer {
  readonly dataSource: DataSource;
  readonly repositories: Repositories;
  readonly services: Services;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly simulation: SimulationSource;
  /** Demo-only handle to the device database (Reset Demo, pass revocation). */
  readonly mockDatabase: MockDatabase;
  /** Demo-only handle to the shared project (daily seeding, Reset shared demo data); null on the device source. */
  readonly serverClient: DataClient | null;
  /**
   * Stops what keeps this container live (D-158): the sync loop, a running voice session, the Realtime channel, the
   * connectivity listeners and whatever boot registered with `onDispose`. Strict Mode and Fast Refresh leave a
   * second container behind in dev. A second call does nothing.
   */
  dispose(): void;
  /** Registers a release for `dispose` (boot's subscriptions); after a dispose it runs at once. */
  onDispose(release: () => void): void;
}

export interface MockContainerOptions {
  readonly store: KeyValueStore;
  /** Device-level preferences (language). Separate from mock data. */
  readonly preferencesStore: KeyValueStore;
  readonly clock: Clock;
  /** The real time of day, for greetings only (D-151): the demo passes the device clock; omitted, it is `clock`. */
  readonly wallClock?: Clock;
  readonly simulation: SimulationSource;
  readonly configOverrides?: ConfigOverridesSource;
  readonly state?: StateConfiguration;
  /** Production wiring: real browser online/offline events and Geolocation API. */
  readonly realDevice?: boolean;
  readonly loginAssist?: LoginAssistSource;
}

export interface SupabaseContainerOptions extends MockContainerOptions {
  readonly client: DataClient;
  /** Device store for cached server reads (offline fallback) and the correction outbox. */
  readonly cacheStore: KeyValueStore;
  /** Demo builds only (the demo boot path): a fresh device's first seed brings the story's packs. Off by default. */
  readonly demoStoryPacks?: boolean;
}

const connectivityFor = (opts: MockContainerOptions): ConnectivityService =>
  opts.realDevice ? new BrowserConnectivity() : new SimulatedConnectivity(opts.simulation);

export function createMockContainer(opts: MockContainerOptions): AppContainer {
  const bus = new EventBus();
  const db = new MockDatabase(opts.store, opts.clock, bus);
  const delay = simulatedDelay(opts.simulation);
  const repositories: Repositories = {
    masterData: new MockMasterDataRepository(db, delay),
    attendance: new MockAttendanceRepository(db),
    corrections: new MockCorrectionRepository(db),
    staffAttendance: new MockStaffAttendanceRepository(db),
    faceEnrolment: new MockFaceEnrolmentRepository(db),
    verification: new MockVerificationRepository(db),
    offlineQueue: new MockOfflineQueueRepository(db),
    packs: new MockBatchPackRepository(db),
    announcements: new MockAnnouncementRepository(db),
    session: new MockSessionRepository(db),
    preferences: new DevicePreferencesRepository(opts.preferencesStore, bus),
    syncGateway: new SimulatedSyncGateway(opts.simulation, opts.clock),
    voiceUsage: new MockVoiceUsageRepository(db),
  };
  return assemble(opts, { dataSource: 'mock', bus, db, repositories, connectivity: connectivityFor(opts), serverClient: null });
}

/** Server-owned data on Supabase; the demo keeps its clock and simulation (connectivity, sync failure) here too. */
export function createSupabaseContainer(opts: SupabaseContainerOptions): AppContainer {
  const bus = new EventBus();
  const db = new MockDatabase(opts.store, opts.clock, bus, { seedServerData: false, demoStoryPacks: opts.demoStoryPacks });
  const connectivity = connectivityFor(opts);
  const supabase = createSupabaseRepositories({
    client: opts.client,
    db,
    cacheStore: opts.cacheStore,
    bus,
    clock: opts.clock,
    isOnline: () => connectivity.isOnline(),
    syncBlocked: () => opts.simulation.get().nextSyncFails,
  });
  // Face flags saved offline reach the shared copy at start when online (a reload) and when the connection returns
  // (corrections go with the sync: `outbox`).
  const unwatch = connectivity.subscribe((online) => {
    if (online) void supabase.faceEnrolment.flush();
  });
  if (connectivity.isOnline()) void supabase.faceEnrolment.flush();
  const repositories: Repositories = {
    masterData: supabase.masterData,
    attendance: supabase.attendance,
    corrections: supabase.corrections,
    staffAttendance: supabase.staffAttendance,
    faceEnrolment: supabase.faceEnrolment,
    verification: new MockVerificationRepository(db),
    offlineQueue: new MockOfflineQueueRepository(db),
    packs: new MockBatchPackRepository(db),
    announcements: supabase.announcements,
    session: supabase.followSession(new MockSessionRepository(db)),
    preferences: new DevicePreferencesRepository(opts.preferencesStore, bus),
    syncGateway: supabase.syncGateway,
    voiceUsage: supabase.voiceUsage,
  };
  const release = () => {
    unwatch();
    supabase.live.dispose();
  };
  return assemble(opts, { dataSource: 'supabase', bus, db, repositories, connectivity, serverClient: supabase.client, outbox: supabase.corrections, release });
}

interface Assembly {
  readonly dataSource: DataSource;
  readonly bus: EventBus;
  readonly db: MockDatabase;
  readonly repositories: Repositories;
  readonly connectivity: ConnectivityService;
  readonly serverClient: DataClient | null;
  /** The Supabase source's correction outbox: counted and drained by the sync (Task 17). */
  readonly outbox?: SyncOutbox;
  /** The source's own release on dispose (the Supabase Realtime channel and connectivity listener). */
  readonly release?: () => void;
}

function assemble(opts: MockContainerOptions, { dataSource, bus, db, repositories, connectivity, serverClient, outbox, release }: Assembly): AppContainer {
  const delay = simulatedDelay(opts.simulation);
  const { masterData, faceEnrolment } = repositories;

  const configuration = new ConfigurationService(opts.state ?? MAHARASHTRA, opts.configOverrides);
  // Face (D-048): real camera + on-device movement check; matching is simulated until a provider exists.
  const faceCapture = new SwitchableFaceCapture(opts.simulation, new CameraFaceCaptureService(opts.clock), new SimulatedFaceCaptureService(opts.simulation, opts.clock));
  const liveness = new RoutedLiveness(
    new BasicClientLivenessService({ mode: () => opts.simulation.get().liveness, loadDetector: loadFaceDetector, wait: delay }),
    new SimulatedLivenessService(opts.simulation),
  );
  const faceMatch = new MockFaceMatchService(opts.simulation, faceEnrolment, opts.clock);
  const auth = new MockAuthService(masterData, repositories.session, opts.clock);

  const location: LocationProvider = opts.realDevice ? new BrowserLocationProvider() : new SimulatedLocationProvider(opts.simulation);
  const session = new SessionService(auth, masterData, configuration, faceMatch, opts.clock, opts.wallClock ?? opts.clock);

  const sync = new SyncService({
    queue: repositories.offlineQueue,
    attendance: repositories.attendance,
    staff: repositories.staffAttendance,
    gateway: repositories.syncGateway,
    connectivity,
    bus,
    clock: opts.clock,
    autoSync: () => configuration.base().offline.autoSync,
    confirmationMs: () => 3500 * Math.max(opts.simulation.get().speed, 0.05),
    outbox,
  });
  const onRecordQueued = () => sync.request();
  const corrections = new CorrectionService(repositories.attendance, repositories.corrections);

  const attendance = new AttendanceService({
    attendance: repositories.attendance,
    corrections: repositories.corrections,
    verification: repositories.verification,
    staffAttendance: repositories.staffAttendance,
    offlineQueue: repositories.offlineQueue,
    packs: repositories.packs,
    isOnline: () => connectivity.isOnline(),
    isPackStale: (downloadedAt) => isPackStale({ batchId: '', downloadedAt }, opts.clock.now(), configuration.base().offline.refreshDays),
    onRecordQueued,
    delay,
  });
  const verification = new VerificationService(repositories.verification, location, faceCapture, faceMatch);
  const drafts = new MarkingDraftService({ attendance: repositories.attendance, now: () => opts.clock.now() });
  const voiceBus = new ActionBus();

  const staffAttendance = new StaffAttendanceService(repositories.staffAttendance, repositories.verification, repositories.offlineQueue, onRecordQueued);
  const announcements = new AnnouncementService(repositories.announcements);
  const reports = new ReportService(repositories.attendance, repositories.corrections, repositories.staffAttendance, corrections, delay);
  const services: Services = {
    auth,
    session,
    configuration,
    connectivity,
    faceCapture,
    liveness,
    faceMatch,
    sync,
    corrections,
    verification,
    attendance,
    drafts,
    staffAttendance,
    reports,
    packs: new BatchPackService(repositories.packs, connectivity, repositories.offlineQueue, delay, masterData),
    announcements,
    loginAssist: opts.loginAssist ?? null,
    voiceBus,
    voice: new VoiceService({
      attendance,
      verification,
      drafts,
      announcements,
      staffAttendance,
      reports,
      bus: voiceBus,
      usageRepo: repositories.voiceUsage,
      connectivity,
      simulation: opts.simulation,
      clock: opts.clock,
    }),
  };

  const lifetime = new Lifetime([() => services.sync.stop(), () => services.voice.dispose(), ...(release ? [release] : [])]);
  const lifecycle = { dispose: () => lifetime.dispose(), onDispose: (fn: () => void) => lifetime.add(fn) };
  return { dataSource, repositories, services, bus, clock: opts.clock, simulation: opts.simulation, mockDatabase: db, serverClient, ...lifecycle };
}
