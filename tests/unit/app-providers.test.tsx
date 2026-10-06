// @vitest-environment jsdom
/**
 * D-158: React Strict Mode mounts AppProviders twice in dev, so the app boots twice. The boot the first mount
 * started is disposed when it resolves (its effect was cleaned up), so one container and one sync loop stay live.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '@/app-shell/AppProviders';
import type { AppRuntime } from '@/app-shell/boot';
import { setup } from '../helpers/app';

const boots = vi.hoisted(() => ({ runtimes: [] as AppRuntime[], live: new Set<AppRuntime>() }));

vi.mock('@/app-shell/boot', () => ({
  bootApp: async (): Promise<AppRuntime> => {
    // `setup()` builds a mock container and starts its sync, as the real boot does.
    const { app } = setup();
    const runtime: AppRuntime = { container: app, demo: null };
    boots.runtimes.push(runtime);
    boots.live.add(runtime);
    const { stop } = app.services.sync;
    vi.spyOn(app.services.sync, 'stop').mockImplementation(() => {
      boots.live.delete(runtime);
      stop.call(app.services.sync);
    });
    vi.spyOn(app, 'dispose');
    return runtime;
  },
}));

afterEach(() => {
  cleanup();
  boots.runtimes.length = 0;
  boots.live.clear();
});

describe('AppProviders', () => {
  it('under Strict Mode boots twice, disposes the first boot and keeps one sync loop', async () => {
    render(
      <StrictMode>
        <AppProviders>
          <p>signed-in tree</p>
        </AppProviders>
      </StrictMode>,
    );
    expect(await screen.findByText('signed-in tree')).toBeInTheDocument();
    expect(boots.runtimes).toHaveLength(2);
    const [first, second] = boots.runtimes;
    expect(first.container.dispose).toHaveBeenCalledTimes(1);
    expect(second.container.dispose).not.toHaveBeenCalled();
    expect([...boots.live]).toEqual([second]);
  });

  it('disposes the runtime it booted when it unmounts', async () => {
    const view = render(
      <AppProviders>
        <p>signed-in tree</p>
      </AppProviders>,
    );
    await screen.findByText('signed-in tree');
    expect(boots.runtimes).toHaveLength(1);
    view.unmount();
    expect(boots.runtimes[0].container.dispose).toHaveBeenCalledTimes(1);
    expect(boots.live.size).toBe(0);
  });
});
