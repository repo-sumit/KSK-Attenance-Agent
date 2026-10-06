import type { I18n } from '@/i18n';
import { routes } from '@/lib/routes';
import type { InstituteMatch, InstructorMatch } from '@/services/auth';
import type { Services } from '@/services/container';
import type { LoginCredentials } from '@/services/login-assist';
import { finishLogin } from './finishLogin';

/** The parts of the login flow (LoginFlow) a picked account moves. */
export interface AssistFlow {
  readonly institute: InstituteMatch | null;
  readonly assistAccount: string | null;
  setInstitute(match: InstituteMatch | null): void;
  setInstructor(match: InstructorMatch | null): void;
  setAssistAccount(id: string | null): void;
}

type LookupReason = 'invalid_format' | 'not_found' | 'failed';

export type AssistError =
  | { readonly kind: 'unknown_account' }
  /** The source could not prepare the account (it threw): nothing was looked up. */
  | { readonly kind: 'failed' }
  /** The screen was left (a deny, Back) while the person was looked up: nothing was changed, nothing to say. */
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'institute'; readonly reason: LookupReason; readonly code: string }
  | { readonly kind: 'trainer'; readonly reason: LookupReason; readonly institute: string };

/** Where to go next (`signedIn`: the session is open, so the login steps leave history), or why not. */
export type AssistStep = { readonly ok: true; readonly route: string; readonly signedIn: boolean } | { readonly ok: false; readonly error: AssistError };

/** A lookup that throws (the server unreachable) is a failure like any other, never a stuck screen. */
async function lookup<T>(run: () => Promise<{ ok: true; value: T } | { ok: false; error: 'invalid_format' | 'not_found' }>) {
  try {
    return await run();
  } catch {
    return { ok: false as const, error: 'failed' as const };
  }
}

/** The credentials of the account picked in this login attempt, or null (no source, no pick). */
export function assistCredentials(services: Services, flow: Pick<AssistFlow, 'assistAccount'>): LoginCredentials | null {
  return (flow.assistAccount && services.loginAssist?.credentials(flow.assistAccount)) || null;
}

interface PersonStep {
  readonly commit?: () => void;
  readonly cancelled?: () => boolean;
}

/**
 * After the institute: the picked person, then "Is this you?" or (without that step) the session, as a typed ID would.
 * `commit` writes what the earlier step found into the flow, only once the person is found, so a failure leaves the
 * flow as it was. `cancelled` is asked when the lookup returns and again once the session opened: a screen the user
 * left changes nothing and leaves nobody signed in. A sign-in that throws is the trainer step's failure (never a rejection the screen must catch).
 */
async function toPerson(services: Services, flow: AssistFlow, institute: InstituteMatch, credentials: LoginCredentials, step: PersonStep = {}): Promise<AssistStep> {
  const found = await lookup(() => services.auth.lookupInstructor(institute.id, credentials.trainerId));
  if (step.cancelled?.()) return { ok: false, error: { kind: 'cancelled' } };
  if (!found.ok) return { ok: false, error: { kind: 'trainer', reason: found.error, institute: institute.shortName } };
  step.commit?.();
  flow.setInstructor(found.value);
  if (services.configuration.base().identity.instructorConfirmStep) return { ok: true, route: routes.loginIdentity, signedIn: false };
  let route: string;
  try {
    route = await finishLogin(services, institute.id, found.value.id);
  } catch {
    return { ok: false, error: { kind: 'trainer', reason: 'failed', institute: institute.shortName } };
  }
  // Left while the session opened: the session for the person backed away from is closed again, never kept.
  if (step.cancelled?.()) {
    await services.auth.signOut().catch(() => undefined);
    return { ok: false, error: { kind: 'cancelled' } };
  }
  return { ok: true, route, signedIn: true };
}

/**
 * A tap on a demo account (step 1): the source prepares the account, its institute code is looked up, then the flow
 * goes where a typed code would: "Is this your institute?" when that step is configured, otherwise straight on to the
 * person. The flow changes only when the step succeeds: a failure (including a source that throws) leaves it as it was.
 */
export async function chooseAccount(services: Services, flow: AssistFlow, id: string): Promise<AssistStep> {
  let credentials: LoginCredentials | null | undefined;
  try {
    credentials = await services.loginAssist?.choose(id);
  } catch {
    return { ok: false, error: { kind: 'failed' } };
  }
  if (!credentials) return { ok: false, error: { kind: 'unknown_account' } };
  const found = await lookup(() => services.auth.lookupInstitute(credentials.instituteCode));
  if (!found.ok) return { ok: false, error: { kind: 'institute', reason: found.error, code: credentials.instituteCode } };
  const commit = () => {
    flow.setInstitute(found.value);
    flow.setAssistAccount(id);
  };
  if (services.configuration.base().identity.instituteConfirmStep) {
    commit();
    return { ok: true, route: routes.loginInstitute, signedIn: false };
  }
  return toPerson(services, flow, found.value, credentials, { commit });
}

/**
 * "Yes, continue" on "Is this your institute?". With an account picked in this attempt the Trainer ID input is
 * skipped (its ID is looked up); without one (production, a typed code, or "Not you?" cleared the pick) it is the
 * Trainer ID input, exactly as before. `cancelled`: the user denied or left while the person was looked up.
 */
export async function continueAfterInstitute(services: Services, flow: AssistFlow, cancelled?: () => boolean): Promise<AssistStep> {
  const credentials = assistCredentials(services, flow);
  if (!credentials || !flow.institute) return { ok: true, route: routes.loginTrainer, signedIn: false };
  return toPerson(services, flow, flow.institute, credentials, { cancelled });
}

/** The step's own error text, as the typed path shows it. */
export function assistErrorText(t: I18n['t'], error: AssistError): string | null {
  if (error.kind === 'unknown_account' || error.kind === 'cancelled') return null;
  if (error.kind === 'failed' || error.reason === 'failed') return t('login.lookupFailed');
  if (error.kind === 'institute') return error.reason === 'invalid_format' ? t('login.codeInvalid') : t('login.codeNotFound', { code: error.code });
  return error.reason === 'invalid_format' ? t('login.trainerInvalid') : t('login.trainerNotFound', { institute: error.institute });
}
