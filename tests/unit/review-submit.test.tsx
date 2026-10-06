// @vitest-environment jsdom
/**
 * D-149: one confirmation per submit. The Review screen is the confirmation (PRD §12.1): its "Submit attendance"
 * saves at once, with no second dialog; a double tap saves once; the screen says the submit is final.
 */
import type { ReactNode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, ToastViewport } from '@/components/ui/Toast';
import { ReviewScreen } from '@/features/attendance/review/ReviewScreen';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { err } from '@/lib/result';
import { routes } from '@/lib/routes';
import type { SessionContext } from '@/services/context';
import { setup, signIn, verify } from '../helpers/app';

const KEY = 'ele-s1u2.2026-09-25.daily';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/attendance/review',
  useSearchParams: () => new URLSearchParams({ s: 'ele-s1u2.2026-09-25.daily' }),
}));
const signed = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/hooks/session', () => ({ useSession: () => signed.ctx, useJourney: () => (signed.ctx as SessionContext).journey }));
// The frame is not under test: render the footer after the content, as the screen shows it.
vi.mock('@/components/shell/ScreenLayout', () => ({
  ScreenLayout: ({ children, footer }: { children?: ReactNode; footer?: ReactNode }) => (
    <main>
      {children}
      <footer>{footer}</footer>
    </main>
  ),
}));
vi.mock('@/features/shell/AppHeader', () => ({ AppHeader: () => null }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Rajesh's verified, open Electrician Shift 1 · Unit 2 at its review; `submit` waits for `release()`. */
async function mountReview() {
  const env = setup();
  const ctx = await signIn(env.app, 'TR-10432');
  await verify(env.app, ctx, KEY);
  signed.ctx = ctx;
  const attendance = env.app.services.attendance;
  const original = attendance.submit.bind(attendance);
  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const submit = vi.spyOn(attendance, 'submit').mockImplementation(async (...args) => {
    await gate;
    return original(...args);
  });
  render(
    <ServicesProvider container={env.app}>
      <I18nProvider>
        <ToastProvider>
          <ReviewScreen />
          <ToastViewport />
        </ToastProvider>
      </I18nProvider>
    </ServicesProvider>,
  );
  const button = await screen.findByRole('button', { name: 'Submit attendance' });
  return { env, submit, button, release };
}

describe('Review: Submit attendance is the one confirmation (D-149)', () => {
  it('submits at once, with no dialog, and lands on the result', async () => {
    const { env, submit, button, release } = await mountReview();
    act(() => button.click());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(submit).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(routes.submitted(KEY)));
    expect(await env.app.repositories.attendance.getSubmission(KEY)).toBeDefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a double tap saves once', async () => {
    const { env, submit, button, release } = await mountReview();
    // Both taps land before React renders the busy state: only the synchronous guard can stop the second.
    act(() => {
      button.click();
      button.click();
    });
    act(() => button.click());
    expect(submit).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(routes.submitted(KEY)));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalledWith(routes.record(KEY));
    expect((await env.app.repositories.attendance.listSubmissions({ from: '2026-09-25', to: '2026-09-25' })).filter((s) => s.sessionKey === KEY)).toHaveLength(1);
  });

  it('is busy while saving, and "Go back and edit" waits for it', async () => {
    const { button, release } = await mountReview();
    act(() => button.click());
    const busy = screen.getByRole('button', { name: 'Submitting attendance…' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Go back and edit' })).toBeDisabled();
    release();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(routes.submitted(KEY)));
  });

  it('says the submit is final, on the screen itself', async () => {
    await mountReview();
    expect(screen.getByText('After you submit, this attendance can’t be edited.')).toBeVisible();
  });

  it('a save that throws frees Submit and Go back again and says so, with no unhandled rejection', async () => {
    const { submit, button, release } = await mountReview();
    submit.mockRejectedValueOnce(new Error('QuotaExceededError'));
    release();
    act(() => button.click());
    expect(await screen.findByText('Couldn’t save. Your marks are kept, try again.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Submit attendance' })).not.toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Go back and edit' })).toBeEnabled();
    expect(router.replace).not.toHaveBeenCalled();
    // The guard is released too: a second tap tries again.
    act(() => screen.getByRole('button', { name: 'Submit attendance' }).click());
    expect(submit).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(routes.submitted(KEY)));
  });

  it('a refusal to submit before own attendance (self_first) goes to the gateway, which explains it (R4)', async () => {
    const { submit, button, release } = await mountReview();
    submit.mockResolvedValueOnce(err('self_first'));
    release();
    act(() => button.click());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(routes.open(KEY)));
  });
});
