// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createDemoAdapters, type DemoAdapters } from '@/demo/adapters';
import { DemoController, prepareScenario } from '@/demo/controller';
import { PRESETS } from '@/demo/presets';
import { createVoicePuppet } from '@/demo/voice-puppet';
import { createMockContainer, type AppContainer } from '@/services/container';
import { MemoryStore } from '@/lib/kv-store';

beforeEach(() => localStorage.clear());

function demoApp(): { demo: DemoAdapters; app: AppContainer } {
  const demo = createDemoAdapters();
  const app = createMockContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock: demo.clock, simulation: demo.simulation, configOverrides: demo.configOverrides, loginAssist: demo.loginAssist });
  demo.repo.update((s) => ({ ...s, simulation: { ...s.simulation, speed: 0 } }));
  return { demo, app };
}

describe('demo voice', () => {
  it('every preset switches Voice Agent on, and only voice.enabled', () => {
    for (const p of PRESETS) expect(p.config.voice).toEqual({ enabled: true });
  });

  it('the voice model belongs to the presenting machine: a preset keeps it, like the camera choice', () => {
    const { demo, app } = demoApp();
    demo.repo.update((s) => ({ ...s, simulation: { ...s.simulation, voice: 'scripted', camera: 'simulated' } }));
    for (const p of PRESETS) {
      prepareScenario(app, demo, p.id);
      expect(demo.repo.get().simulation).toMatchObject({ voice: 'scripted', camera: 'simulated', speed: 0 });
    }
  });

  it('the controller exposes the puppet, bound to the scripted transport', async () => {
    const { demo, app } = demoApp();
    const controller = new DemoController(app, demo, () => {});
    const scripted = app.services.voice.scripted;
    expect(controller.voice.texts()).toEqual([]);
    controller.voice.denyMic();
    expect(scripted.takeMicDenial()).toBe('permission_denied');
    controller.voice.denyMic('not_found');
    expect(scripted.takeMicDenial()).toBe('not_found');
    // Ignored while not connected (the transport's own rule).
    controller.voice.speak('haan');
    controller.voice.emit({ inputText: 'x' });
    controller.voice.drop();
    controller.voice.goAway(1000);
    expect(controller.voice.responses()).toEqual([]);
  });

  it('texts() and responses() are copies (the page cannot rewrite the record)', async () => {
    const { app } = demoApp();
    const puppet = createVoicePuppet(app.services.voice);
    app.services.voice.scripted.texts.push('[APP] one');
    const texts = puppet.texts();
    texts.push('forged');
    expect(puppet.texts()).toEqual(['[APP] one']);
  });
});
