import { describe, expect, it, vi } from 'vitest';
import type { ConfigLayer } from '@/config/types';
import { assistErrorText, chooseAccount, continueAfterInstitute, type AssistFlow } from '@/features/auth/assistSignIn';
import { createI18n } from '@/i18n';
import { MemoryStore } from '@/lib/kv-store';
import { routes } from '@/lib/routes';
import { FixedClock, instantAt } from '@/lib/time';
import type { InstituteMatch, InstructorMatch } from '@/services/auth';
import { createMockContainer, type AppContainer } from '@/services/container';
import type { LoginAssistSource, LoginCredentials } from '@/services/login-assist';
import { DEFAULT_SIMULATION, StaticSimulationSource } from '@/services/simulation';

const ACCOUNTS: Record<string, LoginCredentials> = {
  sunita: { instituteCode: '27410', trainerId: 'TR-10518', who: 'Sunita Jadhav · Batch-mapped instructor' },
  nowhere: { instituteCode: '99998', trainerId: 'TR-10518', who: 'Nobody · Unknown institute' },
  stranger: { instituteCode: '27410', trainerId: 'TR-99999', who: 'Nobody · Unknown trainer' },
};

function fakeSource(): LoginAssistSource & { chosen: string[] } {
  const chosen: string[] = [];
  return {
    chosen,
    get: () => ({ heading: 'Accounts', hint: 'Pick one', options: [], suggested: null }),
    subscribe: () => () => undefined,
    choose: async (id) => {
      chosen.push(id);
      return ACCOUNTS[id] ?? null;
    },
    credentials: (id) => ACCOUNTS[id] ?? null,
  };
}

/** The mock container with a chosen pair of confirm steps (face off, so a sign-in lands on Home). */
function app(steps: { institute: boolean; instructor: boolean }, source: LoginAssistSource | null = fakeSource()): AppContainer {
  const layer: ConfigLayer = { identity: { instituteConfirmStep: steps.institute, instructorConfirmStep: steps.instructor }, verification: { face: false } };
  const container = createMockContainer({
    store: new MemoryStore(),
    preferencesStore: new MemoryStore(),
    clock: new FixedClock(instantAt('2026-09-25', '10:15')),
    simulation: new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0 }),
    configOverrides: { get: () => layer },
    ...(source ? { loginAssist: source } : {}),
  });
  // The mock database seeds on its first read (boot has read it long before a login); a seed would clear a session.
  container.mockDatabase.read('session');
  return container;
}

/** The login flow's setters, recorded (the screens hold them in React state). */
function flow(start: Partial<Pick<AssistFlow, 'institute' | 'assistAccount'>> = {}) {
  const f = {
    institute: start.institute ?? null,
    instructor: null as InstructorMatch | null,
    assistAccount: start.assistAccount ?? null,
    calls: 0,
    setInstitute(m: InstituteMatch | null) {
      f.calls++;
      f.institute = m;
    },
    setInstructor(m: InstructorMatch | null) {
      f.calls++;
      f.instructor = m;
    },
    setAssistAccount(id: string | null) {
      f.calls++;
      f.assistAccount = id;
    },
  };
  return f;
}

describe('assistSignIn: a demo account tap follows the configured confirm steps', () => {
  it('both confirmations on: institute confirm, then identity confirm (the Trainer ID input is skipped)', async () => {
    const a = app({ institute: true, instructor: true });
    const f = flow();
    expect(await chooseAccount(a.services, f, 'sunita')).toEqual({ ok: true, route: routes.loginInstitute, signedIn: false });
    expect(f).toMatchObject({ institute: { code: '27410' }, assistAccount: 'sunita', instructor: null });
    expect(await continueAfterInstitute(a.services, f)).toEqual({ ok: true, route: routes.loginIdentity, signedIn: false });
    expect(f.instructor).toMatchObject({ id: 'st-sunita', name: 'Sunita Jadhav' });
    // Confirmations are never skipped: nobody is signed in yet.
    expect(await a.repositories.session.get()).toBeUndefined();
  });

  it('institute confirmation off: straight to "Is this you?"', async () => {
    const a = app({ institute: false, instructor: true });
    const f = flow();
    expect(await chooseAccount(a.services, f, 'sunita')).toEqual({ ok: true, route: routes.loginIdentity, signedIn: false });
    expect(f.instructor).toMatchObject({ id: 'st-sunita' });
    expect(await a.repositories.session.get()).toBeUndefined();
  });

  it('identity confirmation off: "Yes, continue" on the institute signs in', async () => {
    const a = app({ institute: true, instructor: false });
    const f = flow();
    expect(await chooseAccount(a.services, f, 'sunita')).toMatchObject({ ok: true, route: routes.loginInstitute });
    expect(await a.repositories.session.get()).toBeUndefined();
    expect(await continueAfterInstitute(a.services, f)).toEqual({ ok: true, route: routes.home, signedIn: true });
    expect((await a.repositories.session.get())?.staffId).toBe('st-sunita');
  });

  it('both confirmations off: the tap signs in', async () => {
    const a = app({ institute: false, instructor: false });
    const f = flow();
    expect(await chooseAccount(a.services, f, 'sunita')).toEqual({ ok: true, route: routes.home, signedIn: true });
    expect((await a.repositories.session.get())?.staffId).toBe('st-sunita');
  });

  it('an unknown institute code is the institute step’s error, and the flow is left as it was', async () => {
    const a = app({ institute: true, instructor: true });
    const f = flow();
    const step = await chooseAccount(a.services, f, 'nowhere');
    expect(step).toEqual({ ok: false, error: { kind: 'institute', reason: 'not_found', code: '99998' } });
    expect(f.calls).toBe(0);
    const t = createI18n('en', 'en-IN').t;
    if (!step.ok) expect(assistErrorText(t, step.error)).toBe('No institute found for code 99998. Check the code and try again.');
  });

  it('an unknown Trainer ID is the trainer step’s error after the institute is confirmed', async () => {
    const a = app({ institute: true, instructor: true });
    const f = flow();
    await chooseAccount(a.services, f, 'stranger');
    const step = await continueAfterInstitute(a.services, f);
    expect(step).toEqual({ ok: false, error: { kind: 'trainer', reason: 'not_found', institute: 'Government ITI Pune' } });
    expect(f.instructor).toBeNull();
    const t = createI18n('en', 'en-IN').t;
    if (!step.ok) expect(assistErrorText(t, step.error)).toBe('This Trainer ID is not registered at Government ITI Pune. Check the ID and try again.');
  });

  it('a lookup that throws (the server unreachable) is a failure with a message, never a stuck screen', async () => {
    const a = app({ institute: true, instructor: true });
    vi.spyOn(a.services.auth, 'lookupInstitute').mockRejectedValue(new Error('offline'));
    const f = flow();
    const step = await chooseAccount(a.services, f, 'sunita');
    expect(step).toEqual({ ok: false, error: { kind: 'institute', reason: 'failed', code: '27410' } });
    expect(f.calls).toBe(0);
    const t = createI18n('en', 'en-IN').t;
    if (!step.ok) expect(assistErrorText(t, step.error)).toBe('Couldn’t check right now. Try again.');
  });

  it('a source that throws while preparing the account is a failure with a message, never a stuck list', async () => {
    const source = fakeSource();
    source.choose = () => Promise.reject(new Error('face flag write failed'));
    const a = app({ institute: true, instructor: true }, source);
    const f = flow();
    const step = await chooseAccount(a.services, f, 'sunita');
    expect(step).toEqual({ ok: false, error: { kind: 'failed' } });
    expect(f.calls).toBe(0);
    const t = createI18n('en', 'en-IN').t;
    if (!step.ok) expect(assistErrorText(t, step.error)).toBe('Couldn’t check right now. Try again.');
  });

  it('a sign-in that throws (no confirmation step) is the trainer step’s failure, not a rejection', async () => {
    const a = app({ institute: true, instructor: false });
    vi.spyOn(a.services.auth, 'startSession').mockRejectedValue(new Error('offline'));
    const f = flow();
    await chooseAccount(a.services, f, 'sunita');
    const step = await continueAfterInstitute(a.services, f);
    expect(step).toEqual({ ok: false, error: { kind: 'trainer', reason: 'failed', institute: 'Government ITI Pune' } });
  });

  it('a deny while the person is looked up: cancelled, the flow is left as it was and nobody is signed in', async () => {
    const a = app({ institute: true, instructor: false });
    const f = flow();
    await chooseAccount(a.services, f, 'sunita');
    let left = false;
    const original = a.services.auth.lookupInstructor.bind(a.services.auth);
    vi.spyOn(a.services.auth, 'lookupInstructor').mockImplementation(async (...args) => {
      const found = await original(...args);
      left = true; // the presenter tapped Back while the lookup ran
      return found;
    });
    expect(await continueAfterInstitute(a.services, f, () => left)).toEqual({ ok: false, error: { kind: 'cancelled' } });
    expect(f.instructor).toBeNull();
    expect(await a.repositories.session.get()).toBeUndefined();
  });

  it('a deny while the session opens: cancelled, and the session it opened is closed again', async () => {
    const a = app({ institute: true, instructor: false });
    const f = flow();
    await chooseAccount(a.services, f, 'sunita');
    let left = false;
    const original = a.services.auth.startSession.bind(a.services.auth);
    vi.spyOn(a.services.auth, 'startSession').mockImplementation(async (...args) => {
      const stored = await original(...args);
      left = true; // Back during the sign-in itself
      return stored;
    });
    expect(await continueAfterInstitute(a.services, f, () => left)).toEqual({ ok: false, error: { kind: 'cancelled' } });
    expect(await a.repositories.session.get()).toBeUndefined();
  });

  it('institute confirmation off and the person not found: the flow is left as it was (nothing half-set)', async () => {
    const a = app({ institute: false, instructor: true });
    const f = flow();
    const step = await chooseAccount(a.services, f, 'stranger');
    expect(step).toMatchObject({ ok: false, error: { kind: 'trainer', reason: 'not_found' } });
    expect(f.calls).toBe(0);
    expect(f).toMatchObject({ institute: null, assistAccount: null, instructor: null });
  });

  it('an account the source does not know changes nothing', async () => {
    const a = app({ institute: true, instructor: true });
    const f = flow();
    expect(await chooseAccount(a.services, f, 'nobody')).toEqual({ ok: false, error: { kind: 'unknown_account' } });
    expect(f.calls).toBe(0);
  });
});

describe('assistSignIn without a source (production) or without a pick', () => {
  it('no source: a pick does nothing and "Yes, continue" goes to the Trainer ID input exactly as today', async () => {
    const a = app({ institute: true, instructor: true }, null);
    expect(a.services.loginAssist).toBeNull();
    const lookup = vi.spyOn(a.services.auth, 'lookupInstructor');
    const institute = (await a.services.auth.lookupInstitute('27410')) as { ok: true; value: InstituteMatch };
    const f = flow({ institute: institute.value, assistAccount: 'sunita' });
    expect(await chooseAccount(a.services, f, 'sunita')).toEqual({ ok: false, error: { kind: 'unknown_account' } });
    expect(await continueAfterInstitute(a.services, f)).toEqual({ ok: true, route: routes.loginTrainer, signedIn: false });
    expect(lookup).not.toHaveBeenCalled();
    expect(f.calls).toBe(0);
  });

  it('a source but no pick in this attempt ("Not you?" cleared it, or the code was typed): the Trainer ID input', async () => {
    const source = fakeSource();
    const a = app({ institute: true, instructor: true }, source);
    const lookup = vi.spyOn(a.services.auth, 'lookupInstructor');
    const institute = (await a.services.auth.lookupInstitute('27410')) as { ok: true; value: InstituteMatch };
    const f = flow({ institute: institute.value });
    expect(await continueAfterInstitute(a.services, f)).toEqual({ ok: true, route: routes.loginTrainer, signedIn: false });
    expect(lookup).not.toHaveBeenCalled();
    expect(source.chosen).toEqual([]);
    expect(f.calls).toBe(0);
  });
});
