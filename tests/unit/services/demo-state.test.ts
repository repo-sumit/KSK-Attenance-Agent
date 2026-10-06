import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDemoAdapters } from '@/demo/adapters';
import { PRESETS, PRESETS_VERSION } from '@/demo/presets';
import { DEFAULT_DEMO_STATE, decodeDemoState, upgradeDemoState } from '@/demo/state';
import { MemoryStore } from '@/lib/kv-store';
import { createMockContainer } from '@/services/container';
import { DEFAULT_SIMULATION } from '@/services/simulation';

const open = PRESETS.find((p) => p.id === 'open')!;
const offline = PRESETS.find((p) => p.id === 'offline')!;

/** A state as a browser stored it before Voice Agent: a preset applied, its configuration without `voice`, no presets version. */
const preVoice = (patch: Record<string, unknown> = {}) => ({
  version: 1,
  presetId: 'open',
  persona: 'open',
  config: { verification: { geoMode: 'fencing', face: true }, marking: { defaultStatus: 'present' } },
  simulation: { ...DEFAULT_SIMULATION, speed: 0.5, camera: 'real', liveness: 'auto', voice: 'live', location: 'outside' },
  clock: { mode: 'real' },
  ...patch,
});

describe('demo state: a fresh or reset demo is the Open instructor story', () => {
  it('has the Open instructor preset\'s configuration, so Voice Agent is on', () => {
    expect(DEFAULT_DEMO_STATE.presetId).toBe('open');
    expect(DEFAULT_DEMO_STATE.config).toEqual(open.config);
    expect(DEFAULT_DEMO_STATE.config.voice).toEqual({ enabled: true });
    // A browser with nothing stored, or a stored state that is not a demo state, starts there too.
    expect(decodeDemoState(undefined).config.voice).toEqual({ enabled: true });
    expect(decodeDemoState({ version: 0 }).config.voice).toEqual({ enabled: true });
  });

  it('no longer carries "Skip login screens" (the panel\'s Sign in as signs straight in)', () => {
    expect('skipLogin' in DEFAULT_DEMO_STATE).toBe(false);
  });

  it('resolves to a configuration with Voice Agent on for a fresh browser', () => {
    const demo = createDemoAdapters();
    const app = createMockContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock: demo.clock, simulation: demo.simulation, configOverrides: demo.configOverrides });
    expect(app.services.configuration.base().voice.enabled).toBe(true);
  });
});

describe('demo state: presets version', () => {
  it('starts at 2, and a fresh state carries the current version', () => {
    expect(PRESETS_VERSION).toBe(2);
    expect(DEFAULT_DEMO_STATE.presetsVersion).toBe(PRESETS_VERSION);
    expect(decodeDemoState(undefined)).toBe(DEFAULT_DEMO_STATE);
  });

  it('re-applies the stored preset when the stored version is older (or missing): its configuration now has voice', () => {
    expect(open.config.voice).toEqual({ enabled: true });
    const decoded = decodeDemoState(preVoice());
    expect(decoded.presetId).toBe('open');
    expect(decoded.presetsVersion).toBe(PRESETS_VERSION);
    expect(decoded.config).toEqual(open.config);
    expect(decoded.clock).toEqual({ mode: 'fixed', time: '10:15' });
    expect(decoded.simulation.location).toBe(DEFAULT_SIMULATION.location); // the story's outcomes start again
    // The presenting machine's own settings are not part of the story.
    expect(decoded.simulation).toMatchObject({ speed: 0.5, camera: 'real', voice: 'live' });
    expect(decodeDemoState(preVoice({ presetsVersion: 1 })).config).toEqual(open.config);
  });

  it('keeps the persona, and applies the stored preset\'s own simulation', () => {
    const decoded = decodeDemoState(preVoice({ presetId: 'offline', persona: 'principal' }));
    expect(decoded.persona).toBe('principal');
    expect(decoded.config).toEqual(offline.config);
    expect(decoded.simulation.online).toBe(false);
  });

  it('leaves a state with no preset alone (the presenter\'s own panel changes), whatever its version', () => {
    const own = preVoice({ presetId: null, config: { marking: { defaultStatus: 'blank' } } });
    const decoded = decodeDemoState(own);
    expect(decoded.presetId).toBeNull();
    expect(decoded.config).toEqual({ marking: { defaultStatus: 'blank' } });
    expect(decoded.clock).toEqual({ mode: 'real' });
    expect(decoded.simulation.location).toBe('outside');
  });

  it('leaves a current-version state, and a preset the code no longer has, alone', () => {
    const current = decodeDemoState(preVoice({ presetsVersion: PRESETS_VERSION, config: { marking: { defaultStatus: 'blank' } } }));
    expect(current.config).toEqual({ marking: { defaultStatus: 'blank' } });
    expect(current.clock).toEqual({ mode: 'real' });
    const gone = decodeDemoState(preVoice({ presetId: 'retired' }));
    expect(gone.presetId).toBe('retired');
    expect(gone.config).toEqual(preVoice().config);
  });

  it('is idempotent: upgrading an upgraded state changes nothing', () => {
    const once = decodeDemoState(preVoice());
    expect(upgradeDemoState(once)).toBe(once);
    expect(decodeDemoState(JSON.parse(JSON.stringify(once)))).toEqual(once);
  });

  it('the E2E fixture seeds the current version, so a bump here is a visible edit there', () => {
    const fixture = readFileSync('tests/e2e/fixtures.ts', 'utf8');
    expect(fixture).toContain(`presetsVersion: ${PRESETS_VERSION},`);
  });
});
