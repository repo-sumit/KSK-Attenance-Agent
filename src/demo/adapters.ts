/**
 * DEMO ONLY — the single entry point the app imports (behind
 * NEXT_PUBLIC_DEMO_MODE). Turns DemoState into the interfaces the core already
 * accepts: a Clock, a SimulationSource, a ConfigOverridesSource and a
 * LoginAssistSource.
 */
import type { ConfigLayer } from '@/config/types';
import type { ConfigOverridesSource } from '@/services/configuration';
import type { LoginAssist, LoginAssistOption, LoginAssistSource, LoginCredentials } from '@/services/login-assist';
import type { SimulationSource, SimulationState } from '@/services/simulation';
import { createDefaultStore } from '@/lib/kv-store';
import { instantAt, toLocalDate, type Clock } from '@/lib/time';
import { DemoStateRepository } from './store';
import { PERSONAS, personaById, personaForStaff, type PersonaId } from './personas';
import { PRESETS } from './presets';
import { mergeConfigLayer } from '@/config/resolve';

/** Sentinel checked by scripts/check-demo-stripped.mjs: must not appear in a non-demo build. */
export const DEMO_SENTINEL = '__KSK_DEMO__';

export class DemoClock implements Clock {
  constructor(private readonly repo: DemoStateRepository) {}
  now(): Date {
    const setting = this.repo.get().clock;
    const real = new Date();
    return setting.mode === 'real' ? real : instantAt(toLocalDate(real), setting.time);
  }
}

class DemoSimulationSource implements SimulationSource {
  constructor(private readonly repo: DemoStateRepository) {}
  get(): SimulationState {
    return this.repo.get().simulation;
  }
  update(patch: Partial<SimulationState>): void {
    this.repo.update((s) => ({ ...s, simulation: { ...s.simulation, ...patch } }));
  }
  subscribe(listener: () => void) {
    return this.repo.subscribe(listener);
  }
}

/** Persona patch first (who is signed in), then the presenter's explicit panel changes on top. */
class DemoConfigOverrides implements ConfigOverridesSource {
  constructor(private readonly repo: DemoStateRepository) {}
  get(context?: { readonly staffId?: string }): ConfigLayer {
    const persona = personaForStaff(context?.staffId);
    return mergeConfigLayer<ConfigLayer>(persona?.config ?? {}, this.repo.get().config);
  }
}

/**
 * "Demo accounts" on the login screen: every persona, in persona order. Each
 * account's id is both its persona and the preset that tells its story (same
 * ids), so a row's line is that story's line.
 */
export const DEMO_ACCOUNTS: readonly PersonaId[] = PERSONAS.map((p) => p.id);

const OPTIONS: readonly LoginAssistOption[] = DEMO_ACCOUNTS.map((id) => {
  const p = personaById(id);
  return { id, label: p.title, who: p.name, line: PRESETS.find((s) => s.id === id)?.line ?? '' };
});

/** The list's text (demo tooling is English-only, D-047). Also the needles of scripts/check-demo-stripped.mjs. */
const HEADING = 'Demo accounts';
const HINT = 'Tap a person: you still confirm the institute and the person.';
const CREDENTIALS: ReadonlyMap<string, LoginCredentials> = new Map(
  DEMO_ACCOUNTS.map((id) => {
    const p = personaById(id);
    return [id, { instituteCode: p.instituteCode, trainerId: p.trainerId, who: `${p.name} · ${p.title}` }] as const;
  }),
);

/** Gets a demo account's story ready (persona, configuration, simulation, clock, face enrolment) without signing in. */
export type PrepareDemoAccount = (presetId: string) => unknown;

/**
 * The login screen's demo accounts. It is built before the app container
 * exists, so the step that prepares an account's story is connected afterwards
 * (boot.ts). The persona picked last in the demo panel is only highlighted:
 * nothing happens until the user taps an account.
 */
export class DemoLoginAssist implements LoginAssistSource {
  private prepare: PrepareDemoAccount | null = null;
  private cache: { persona: PersonaId; value: LoginAssist } | null = null;
  constructor(private readonly repo: DemoStateRepository) {}

  connect(prepare: PrepareDemoAccount): void {
    this.prepare = prepare;
  }

  get(): LoginAssist {
    const persona = this.repo.get().persona;
    // Stable identity per persona, so React's external-store reads don't loop.
    if (this.cache?.persona !== persona)
      this.cache = {
        persona,
        value: { heading: HEADING, hint: HINT, options: OPTIONS, suggested: DEMO_ACCOUNTS.includes(persona) ? persona : null },
      };
    return this.cache.value;
  }

  subscribe(listener: () => void) {
    return this.repo.subscribe(listener);
  }

  credentials(id: string): LoginCredentials | null {
    return CREDENTIALS.get(id) ?? null;
  }

  async choose(id: string): Promise<LoginCredentials | null> {
    const credentials = this.credentials(id);
    if (!credentials) return null;
    // A story that starts at login (First-time user) is already about this account: keep it
    // (face not registered, permissions not asked) instead of swapping in the everyday preset.
    const story = PRESETS.find((p) => p.id === this.repo.get().presetId);
    if (!(story?.start === 'login' && story.persona === id)) await this.prepare?.(id);
    return credentials;
  }
}

export interface DemoAdapters {
  readonly repo: DemoStateRepository;
  readonly clock: Clock;
  readonly simulation: SimulationSource;
  readonly configOverrides: ConfigOverridesSource;
  readonly loginAssist: DemoLoginAssist;
  readonly sentinel: string;
}

export function createDemoAdapters(): DemoAdapters {
  const repo = new DemoStateRepository(createDefaultStore('ksk-demo:v1'));
  return {
    repo,
    clock: new DemoClock(repo),
    simulation: new DemoSimulationSource(repo),
    configOverrides: new DemoConfigOverrides(repo),
    loginAssist: new DemoLoginAssist(repo),
    sentinel: DEMO_SENTINEL,
  };
}
