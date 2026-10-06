/**
 * VoiceService: the one entry point the UI calls for Voice Agent (voice design §5, D-085). `plan` says whether voice
 * exists for a session (instructors and the principal, D-139); `start` (synchronous, from the Voice Agent click) builds the voice plan, the executor, the
 * Live setup, the usage caps and the VoiceSession, then starts it. Scripted mode (demo and E2E) swaps in the
 * ScriptedLiveTransport and SilentAudio; live mode loads the Gemini transport with import() only when it is needed,
 * so the SDK never reaches the first-load bundle.
 */
import type { Language } from '@/config/types';
import { compileVoicePlan, type VoicePlan } from '@/domain/voice/plan';
import { voiceFor } from '@/domain/voice/voices';
import { toLocalDate } from '@/lib/time';
import type { Clock } from '@/lib/time';
import type { VoiceUsageRepository } from '@/repositories/interfaces';
import type { AnnouncementService } from '../announcements';
import type { AttendanceService } from '../attendance';
import type { ConnectivityService } from '../connectivity';
import type { SessionContext } from '../context';
import type { MarkingDraftService } from '../marking-draft';
import type { ReportService } from '../reports';
import type { SimulationSource } from '../simulation';
import type { StaffAttendanceService } from '../staff-attendance';
import { ScriptedLiveTransport, SilentAudio } from '../simulated/voice';
import type { VerificationService } from '../verification';
import type { ActionBus } from './action-bus';
import { voiceDebug } from './debug';
import { createBrowserAudio } from './audio/browser-audio';
import { createExecutor } from './executor';
import { fetchLiveToken } from './live/token-client';
import type { LiveSetup, LiveTransport } from './live/transport';
import { buildSystemPrompt, firstName, SPEECH_LANGUAGE } from './prompt';
import { VoiceSession } from './session';
import { buildTools } from './tools';
import { VoiceUsage } from './usage';

export interface VoiceServiceDeps {
  readonly attendance: AttendanceService;
  readonly verification: VerificationService;
  readonly drafts: MarkingDraftService;
  readonly announcements: AnnouncementService;
  readonly staffAttendance: StaffAttendanceService;
  readonly reports: ReportService;
  readonly bus: ActionBus;
  readonly usageRepo: VoiceUsageRepository;
  readonly connectivity: ConnectivityService;
  readonly simulation: SimulationSource;
  readonly clock: Clock;
  /** Loads the Gemini transport (tests inject one); default: import() of ./live/gemini, outside the first-load bundle. */
  readonly liveTransport?: () => Promise<LiveTransport>;
}

const loadGemini = (): Promise<LiveTransport> => import('./live/gemini').then((m) => m.geminiTransport);

const MODEL = 'gemini-3.8-live';

const TODAY_TEXT = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

export class VoiceService {
  /** The demo/E2E driver; used for new sessions while simulation.voice === 'scripted'. */
  readonly scripted = new ScriptedLiveTransport();
  private session: VoiceSession | null = null;
  /** The one live transport load, shared by prefetch() and every session; a failed load is dropped so the next call retries. */
  private liveLoad: Promise<LiveTransport> | null = null;

  constructor(private readonly deps: VoiceServiceDeps) {}

  /**
   * Whether warming the start is worth it (D-138): only a live session, while online, connects to Gemini. The UI asks
   * before it preconnects, so it never branches on the Voice Agent itself.
   */
  canWarm(): boolean {
    return this.deps.simulation.get().voice !== 'scripted' && this.deps.connectivity.isOnline();
  }

  /**
   * Starts the live transport download ahead of the Voice Agent tap (D-138), so the tap does not wait for the SDK.
   * Scripted mode and offline: nothing (canWarm). Never throws; a failed prefetch is retried by the real start.
   */
  prefetch(): void {
    if (!this.canWarm()) return;
    try {
      this.loadLive().catch(() => undefined);
    } catch {
      /* a loader that cannot even start: the real start tries again */
    }
  }

  private loadLive(): Promise<LiveTransport> {
    if (!this.liveLoad) {
      const load = (this.deps.liveTransport ?? loadGemini)();
      this.liveLoad = load;
      load.catch(() => {
        if (this.liveLoad === load) this.liveLoad = null;
      });
    }
    return this.liveLoad;
  }

  /** The container is going away (D-158): a running session stops. */
  dispose(): void {
    this.session?.stop();
  }

  /** The voice plan for this session, or null when voice does not exist for it. */
  plan(ctx: SessionContext, screenLanguage: Language): VoicePlan | null {
    return compileVoicePlan(ctx, screenLanguage);
  }

  /** The session started last while it is running (the screen sync reaches `onScreen` through it); null before a start and once it has ended. */
  current(): VoiceSession | null {
    return this.session?.getState().status === 'ended' ? null : this.session;
  }

  /** Call synchronously from the Voice Agent click: builds plan, executor and session, then session.start(). Null when plan() is null. */
  start(ctx: SessionContext, screenLanguage: Language): VoiceSession | null {
    const plan = this.plan(ctx, screenLanguage);
    if (!plan) return null;
    const { deps, scripted } = this;
    this.session?.stop();

    // The executor is built first, so it reads the live counters of the session created next, never a snapshot.
    const holder: { session?: VoiceSession } = {};
    const executor = createExecutor({
      ctx,
      plan,
      attendance: deps.attendance,
      verification: deps.verification,
      drafts: deps.drafts,
      announcements: deps.announcements,
      staffAttendance: deps.staffAttendance,
      reports: deps.reports,
      bus: deps.bus,
      isOnline: () => deps.connectivity.isOnline(),
      nowMs: () => performance.now(),
      speechSeq: () => holder.session?.speechSeq() ?? 0,
      turnSeq: () => holder.session?.turnSeq() ?? 0,
      spokeAtTurn: () => holder.session?.spokeAtTurn() ?? 0,
      generation: () => holder.session?.generation() ?? 0,
      entropy: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
    });

    const who = { trainerFirstName: firstName(ctx.user.name), instituteName: ctx.institute.shortName, todayText: TODAY_TEXT.format(deps.clock.now()) };
    // one fixed voice per opening language (D-155), chosen once: every reconnect and goAway swap reuses it
    const voiceName = voiceFor(ctx.journey.voice, plan.openingLanguage);
    const setup = async (handle?: string): Promise<LiveSetup> => ({
      model: MODEL,
      systemInstruction: buildSystemPrompt(plan, who),
      tools: buildTools(plan),
      voiceName,
      resumeHandle: handle,
    });
    const usage = new VoiceUsage({
      repo: deps.usageRepo,
      staffId: ctx.user.id,
      today: () => toLocalDate(deps.clock.now()),
      limits: ctx.journey.voice.limits,
    });
    const common = {
      executor,
      setup,
      usage,
      drafts: deps.drafts,
      verification: deps.verification,
      bus: deps.bus,
      isOnline: () => deps.connectivity.isOnline(),
      onOnlineChange: (listener: (online: boolean) => void) => deps.connectivity.subscribe(listener),
      languageName: SPEECH_LANGUAGE[plan.openingLanguage],
      log: voiceDebug,
      token: () => fetchLiveToken(),
    };

    const session =
      deps.simulation.get().voice === 'scripted'
        ? new VoiceSession({ ...common, transport: async () => scripted, audio: () => new SilentAudio(scripted) })
        : new VoiceSession({
            ...common,
            transport: () => this.loadLive(),
            audio: createBrowserAudio,
          });
    holder.session = this.session = session;
    session.start();
    return session;
  }
}
