// @vitest-environment jsdom
/**
 * With a network-backed data source (D-143) loading a session takes a round trip. A sign-in while signed out must
 * read as loading (route guards wait instead of sending the user to login), and an earlier, faster load must never
 * overwrite a later one. Found in the Task 10 live smoke: `/?preset=batch` landed on /login.
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ServicesProvider } from '@/hooks/services';
import { SessionProvider, useSessionState } from '@/hooks/session';
import { EventBus } from '@/lib/events';
import type { AppContainer } from '@/services/container';
import type { SessionContext } from '@/services/context';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function Status() {
  const { state } = useSessionState();
  return <p>{state.status}</p>;
}

function mount() {
  const bus = new EventBus();
  const loads: Array<ReturnType<typeof deferred<SessionContext | undefined>>> = [];
  const container = {
    bus,
    services: {
      session: {
        load: () => {
          const d = deferred<SessionContext | undefined>();
          loads.push(d);
          return d.promise;
        },
      },
    },
  } as unknown as AppContainer;
  render(
    <ServicesProvider container={container}>
      <SessionProvider>
        <Status />
      </SessionProvider>
    </ServicesProvider>,
  );
  return { bus, loads };
}

const ctx = { user: { id: 'st-sunita' } } as unknown as SessionContext;

describe('SessionProvider', () => {
  it('reads a sign-in while signed out as loading until the new session has loaded', async () => {
    const { bus, loads } = mount();
    await act(async () => loads[0].resolve(undefined));
    expect(screen.getByText('signed_out')).toBeInTheDocument();
    act(() => bus.emit('session'));
    expect(screen.getByText('loading')).toBeInTheDocument();
    await act(async () => loads[1].resolve(ctx));
    expect(screen.getByText('ready')).toBeInTheDocument();
  });

  it('ignores an earlier load that finishes after a later one', async () => {
    const { bus, loads } = mount();
    act(() => bus.emit('session'));
    await act(async () => loads[1].resolve(ctx));
    await act(async () => loads[0].resolve(undefined));
    expect(screen.getByText('ready')).toBeInTheDocument();
  });
});
