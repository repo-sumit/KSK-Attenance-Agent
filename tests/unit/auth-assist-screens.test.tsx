// @vitest-environment jsdom
/**
 * Task 12 (Task 11 review findings): the login screens never get stuck on a failure, and a deny wins over a lookup
 * still running. Mock container, a fake demo source, the real screens (ScreenLayout reduced to its slots).
 */
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfigLayer } from '@/config/types';
import { ConfirmInstituteScreen } from '@/features/auth/ConfirmInstituteScreen';
import { InstituteCodeScreen } from '@/features/auth/InstituteCodeScreen';
import { TrainerIdScreen } from '@/features/auth/TrainerIdScreen';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { MemoryStore } from '@/lib/kv-store';
import { routes } from '@/lib/routes';
import { FixedClock, instantAt } from '@/lib/time';
import type { InstituteMatch, InstructorMatch } from '@/services/auth';
import { createMockContainer, type AppContainer } from '@/services/container';
import type { LoginAssistSource, LoginCredentials } from '@/services/login-assist';
import { DEFAULT_SIMULATION, StaticSimulationSource } from '@/services/simulation';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/login', useSearchParams: () => new URLSearchParams() }));
vi.mock('next/image', () => ({ default: () => null }));
vi.mock('@/components/shell/ScreenLayout', () => ({
  ScreenLayout: ({ children, header, footer }: { children: ReactNode; header?: ReactNode; footer?: ReactNode }) => (
    <main>
      {header}
      {children}
      {footer}
    </main>
  ),
}));

/** The login flow, as plain state the test can read (the screens keep it in React state). */
const flow = vi.hoisted(() => ({
  institute: null as InstituteMatch | null,
  instructor: null as InstructorMatch | null,
  assistAccount: null as string | null,
  setInstitute: (m: InstituteMatch | null) => void (flow.institute = m),
  setInstructor: (m: InstructorMatch | null) => void (flow.instructor = m),
  setAssistAccount: (id: string | null) => void (flow.assistAccount = id),
  reset: () => {
    flow.institute = null;
    flow.instructor = null;
    flow.assistAccount = null;
  },
}));
vi.mock('@/features/auth/LoginFlow', () => ({ useLoginFlow: () => flow, LoginFlowProvider: ({ children }: { children: ReactNode }) => children }));

const SUNITA: LoginCredentials = { instituteCode: '27410', trainerId: 'TR-10518', who: 'Sunita Jadhav · Batch-mapped instructor' };

function source(choose: LoginAssistSource['choose'] = async () => SUNITA): LoginAssistSource {
  const value = { heading: 'Demo accounts', hint: 'Tap a person', options: [{ id: 'sunita', label: 'Batch-mapped instructor', who: 'Sunita Jadhav', line: 'Only assigned batches' }], suggested: null };
  return { get: () => value, subscribe: () => () => undefined, choose, credentials: (id) => (id === 'sunita' ? SUNITA : null) };
}

function app(identity: { instituteConfirmStep: boolean; instructorConfirmStep: boolean }, assist: LoginAssistSource | null = source()): AppContainer {
  const layer: ConfigLayer = { identity, verification: { face: false } };
  const container = createMockContainer({
    store: new MemoryStore(),
    preferencesStore: new MemoryStore(),
    clock: new FixedClock(instantAt('2026-09-25', '10:15')),
    simulation: new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0 }),
    configOverrides: { get: () => layer },
    ...(assist ? { loginAssist: assist } : {}),
  });
  container.mockDatabase.read('session');
  return container;
}

function mount(container: AppContainer, ui: ReactNode) {
  render(
    <ServicesProvider container={container}>
      <I18nProvider>{ui}</I18nProvider>
    </ServicesProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  flow.reset();
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  cleanup();
  expect(errors).not.toHaveBeenCalled();
});

describe('Demo accounts list: a failure never leaves the list stuck', () => {
  it('a source that throws while preparing the account re-enables the rows and Continue and says why', async () => {
    const a = app({ instituteConfirmStep: true, instructorConfirmStep: true }, source(() => Promise.reject(new Error('face flag write failed'))));
    mount(a, <InstituteCodeScreen />);
    const row = screen.getByRole('button', { name: /Batch-mapped instructor/ });
    await act(async () => fireEvent.click(row));
    expect(await screen.findByText('Couldn’t check right now. Try again.')).toBeInTheDocument();
    expect(row).not.toBeDisabled();
    expect(row).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled(); // the code was filled; Continue works again
    expect(router.push).not.toHaveBeenCalled();
  });

  it('labels only the list (the section is not a second "Demo accounts" landmark)', () => {
    mount(app({ instituteConfirmStep: true, instructorConfirmStep: true }), <InstituteCodeScreen />);
    expect(screen.getByRole('list', { name: 'Demo accounts' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Demo accounts' })).toBeNull();
  });
});

describe('Is this your institute?, after a picked account', () => {
  async function onConfirm(identity: { instituteConfirmStep: boolean; instructorConfirmStep: boolean }) {
    const a = app(identity);
    const institute = (await a.services.auth.lookupInstitute('27410')) as { ok: true; value: InstituteMatch };
    flow.institute = institute.value;
    flow.assistAccount = 'sunita';
    return a;
  }

  it('a deny during the person lookup wins: a late result neither moves on nor signs in', async () => {
    const a = await onConfirm({ instituteConfirmStep: true, instructorConfirmStep: false });
    const pending = deferred<Awaited<ReturnType<AppContainer['services']['auth']['lookupInstructor']>>>();
    const real = a.services.auth.lookupInstructor.bind(a.services.auth);
    vi.spyOn(a.services.auth, 'lookupInstructor').mockImplementation(() => pending.promise);
    mount(a, <ConfirmInstituteScreen />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, continue' })));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.replace).toHaveBeenCalledWith(routes.login);
    await act(async () => pending.resolve(await real('inst-27410', 'TR-10518')));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
    expect(await a.repositories.session.get()).toBeUndefined();
    expect(flow.instructor).toBeNull();
  });

  it('a sign-in that throws (no identity step) resets the button and says why', async () => {
    const a = await onConfirm({ instituteConfirmStep: true, instructorConfirmStep: false });
    vi.spyOn(a.services.auth, 'startSession').mockRejectedValue(new Error('offline'));
    mount(a, <ConfirmInstituteScreen />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Yes, continue' })));
    expect(await screen.findByText('Couldn’t check right now. Try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes, continue' })).not.toBeDisabled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('Trainer ID (typed): a failure never leaves Continue stuck', () => {
  it('a sign-in that throws (no identity step) resets Continue and says why', async () => {
    const a = app({ instituteConfirmStep: true, instructorConfirmStep: false }, null);
    const institute = (await a.services.auth.lookupInstitute('27410')) as { ok: true; value: InstituteMatch };
    flow.institute = institute.value;
    vi.spyOn(a.services.auth, 'startSession').mockRejectedValue(new Error('offline'));
    mount(a, <TrainerIdScreen />);
    fireEvent.change(screen.getByLabelText('Trainer ID'), { target: { value: 'TR-10518' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })));
    expect(await screen.findByText('Couldn’t check right now. Try again.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled());
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('Institute code (typed): a failure never leaves Continue stuck', () => {
  it('a lookup that throws (the server unreachable) resets Continue and says why', async () => {
    const a = app({ instituteConfirmStep: true, instructorConfirmStep: true }, null);
    vi.spyOn(a.services.auth, 'lookupInstitute').mockRejectedValue(new Error('offline'));
    mount(a, <InstituteCodeScreen />);
    fireEvent.change(screen.getByLabelText('Institute code'), { target: { value: '27410' } });
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })));
    expect(await screen.findByText('Couldn’t check right now. Try again.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Continue' })).not.toHaveAttribute('aria-busy', 'true'));
    expect(screen.getByRole('button', { name: 'Continue' })).not.toBeDisabled();
    expect(flow.institute).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('Demo accounts list: a failed pick forgets an earlier one', () => {
  it('the field shows the failed pick’s code, so an earlier pick in this attempt is cleared (no mismatched lookup later)', async () => {
    const a = app({ instituteConfirmStep: true, instructorConfirmStep: true });
    flow.assistAccount = 'sunita'; // picked earlier, then the user came back to step 1 without a deny
    vi.spyOn(a.services.auth, 'lookupInstitute').mockRejectedValue(new Error('offline'));
    mount(a, <InstituteCodeScreen />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Batch-mapped instructor/ })));
    expect(await screen.findByText('Couldn’t check right now. Try again.')).toBeInTheDocument();
    expect(flow.assistAccount).toBeNull();
  });
});
