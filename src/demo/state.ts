/**
 * DEMO ONLY. The presenter's state: configuration overrides, simulated
 * outcomes and the demo clock. Removable with the rest of src/demo.
 */
import type { ConfigLayer } from '@/config/types';
import { DEFAULT_SIMULATION, type SimulationState } from '@/services/simulation';
import type { LocalTime } from '@/lib/time';
import type { PersonaId } from './personas';
import { PRESETS, PRESETS_VERSION, type DemoPreset } from './presets';

/** Where the demo's server-owned data lives: the shared Supabase project (when configured) or this device (D-143). */
export type DataChoice = 'shared' | 'device';

export type DemoClockSetting = { readonly mode: 'fixed'; readonly time: LocalTime } | { readonly mode: 'real' };

export interface DemoState {
  readonly version: 1;
  readonly presetId: string | null;
  /** The PRESETS_VERSION the stored preset configuration came from; an older one is re-applied on start-up. */
  readonly presetsVersion: number;
  /** The persona the presenter picked last (Sign in as, a story, a demo account): highlighted under "Demo accounts". */
  readonly persona: PersonaId;
  readonly config: ConfigLayer;
  readonly simulation: SimulationState;
  readonly clock: DemoClockSetting;
  /** Read once at boot: a change applies after the reload the panel does. Presets never change it. */
  readonly data: DataChoice;
}

/** 10:15 AM: Shift 1 open, Shift 2 opens at 2 PM, timetable Period 3 is "Now". */
export const DEFAULT_DEMO_TIME: LocalTime = '10:15';

/** The everyday story a fresh browser and a Reset demo start with. */
const OPEN_STORY = PRESETS.find((p) => p.id === 'open')!;

/**
 * A fresh browser or a Reset demo is the Open instructor story, configuration included (Voice Agent on, as in every
 * story), so it matches the `presetId` it claims. No PRESETS_VERSION bump: no stored preset changed, and the E2E
 * fixture stores `config: {}` at the current version on purpose.
 */
export const DEFAULT_DEMO_STATE: DemoState = {
  version: 1,
  presetId: OPEN_STORY.id,
  presetsVersion: PRESETS_VERSION,
  persona: OPEN_STORY.persona,
  config: OPEN_STORY.config,
  simulation: DEFAULT_SIMULATION,
  clock: { mode: 'fixed', time: DEFAULT_DEMO_TIME },
  data: 'shared',
};

/**
 * The state a preset sets: who is demonstrated, its configuration, fresh simulated outcomes and the demo clock.
 * Speed, the camera choice and the voice model belong to the presenting machine (e.g. a laptop without a camera, or a
 * room without a microphone or the Gemini key), not to the story, so they stay. `keepPersona`: a start-up refresh keeps
 * whoever the presenter picked last.
 */
export function applyPresetState(s: DemoState, preset: DemoPreset, keepPersona = false): DemoState {
  return {
    ...s,
    presetId: preset.id,
    presetsVersion: PRESETS_VERSION,
    persona: keepPersona ? s.persona : preset.persona,
    config: preset.config,
    simulation: { ...DEFAULT_SIMULATION, speed: s.simulation.speed, camera: s.simulation.camera, liveness: s.simulation.liveness, voice: s.simulation.voice, ...preset.simulation },
    clock: { mode: 'fixed', time: DEFAULT_DEMO_TIME },
  };
}

/**
 * A stored preset keeps the configuration it had when it was applied, so a code update that changes a preset (Voice Agent
 * on in every story, version 2) would never reach a browser that already applied it. When the stored version differs, the
 * stored preset is applied again (the persona and the sign-in stay). A state with no preset (`presetId: null`: the
 * presenter's own panel changes) or one the code no longer has is left alone.
 */
export function upgradeDemoState(s: DemoState): DemoState {
  if (s.presetsVersion === PRESETS_VERSION || s.presetId === null) return s;
  const preset = PRESETS.find((p) => p.id === s.presetId);
  return preset ? applyPresetState(s, preset, true) : s;
}

export function decodeDemoState(raw: unknown): DemoState {
  if (!raw || typeof raw !== 'object' || (raw as { version?: unknown }).version !== 1) return DEFAULT_DEMO_STATE;
  const s = raw as Partial<DemoState>;
  return upgradeDemoState({
    ...DEFAULT_DEMO_STATE,
    ...s,
    // A state stored before presets were versioned came from version 1.
    presetsVersion: typeof s.presetsVersion === 'number' ? s.presetsVersion : 1,
    data: s.data === 'device' ? 'device' : 'shared',
    simulation: { ...DEFAULT_SIMULATION, ...s.simulation, permissions: { ...DEFAULT_SIMULATION.permissions, ...s.simulation?.permissions } },
  });
}
