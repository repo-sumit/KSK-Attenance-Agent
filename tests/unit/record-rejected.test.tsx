// @vitest-environment jsdom
/**
 * Task 15: a record the server refused (someone else submitted the batch first) is never shown as "waiting to sync".
 * Where the server's copy cannot be read, the record screen says it was not saved, with an icon (status = icon + text
 * + colour), and offers no correction.
 */
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Icon } from '@/components/ui/icons/Icon';
import { ToastProvider } from '@/components/ui/Toast';
import { RecordScreen } from '@/features/attendance/record/RecordScreen';
import homeStyles from '@/features/home/Home.module.css';
import { SubmittedToday } from '@/features/home/parts';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import type { SessionContext } from '@/services/context';
import { setup, signIn, verify } from '../helpers/app';

const KEY = 'ele-s1u2.2026-09-25.daily';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/record',
  useSearchParams: () => new URLSearchParams({ s: 'ele-s1u2.2026-09-25.daily' }),
}));
const signed = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/hooks/session', () => ({
  useSession: () => signed.ctx,
  useJourney: () => (signed.ctx as SessionContext).journey,
}));
// The screen's frame and header are not under test here.
vi.mock('@/components/shell/ScreenLayout', () => ({
  ScreenLayout: ({ top, children }: { top?: ReactNode; children?: ReactNode }) => (
    <main>
      {top}
      {children}
    </main>
  ),
}));
vi.mock('@/features/shell/AppHeader', () => ({ AppHeader: () => null }));

afterEach(cleanup);

async function refusedRecord() {
  const env = setup();
  const ctx = await signIn(env.app, 'TR-10432');
  await verify(env.app, ctx, KEY);
  const roster = await env.app.services.attendance.openRoster(ctx, KEY);
  if (!roster.ok) throw new Error(roster.error);
  env.simulation.update({ online: false });
  const locked = await env.app.services.attendance.submit(ctx, KEY, roster.value.marks);
  if (!locked.ok) throw new Error(locked.error);
  const mine = await env.app.repositories.attendance.getSubmission(KEY);
  if (!mine) throw new Error('missing');
  // What SyncService records when the server answers `rejected`.
  await env.app.repositories.attendance.markSubmissionRejected(mine.id);
  signed.ctx = ctx;
  return env;
}

describe('RecordScreen: a refused record', () => {
  it('shows "Not saved" with a warning icon, never "waiting to sync"', async () => {
    const env = await refusedRecord();
    const errors = vi.spyOn(console, 'error');
    render(
      <ServicesProvider container={env.app}>
        <I18nProvider>
          <ToastProvider>
            <RecordScreen />
          </ToastProvider>
        </I18nProvider>
      </ServicesProvider>,
    );
    const status = await screen.findByText('Not saved: someone else submitted this batch first.');
    expect(screen.queryByText(/waiting to sync/i)).toBeNull();
    // The strip's icon is the warning sign (the waiting record's is the upload cloud).
    const icon = status.closest('div')?.querySelector('svg');
    const { container } = render(<Icon name="alert" size={16} />);
    expect(icon?.innerHTML).toBe(container.querySelector('svg')?.innerHTML);
    expect(screen.queryByRole('link')).toBeNull(); // nothing to correct
    expect(errors).not.toHaveBeenCalled();
  });
});

const tree = (env: Awaited<ReturnType<typeof refusedRecord>>, node: ReactNode) => (
  <ServicesProvider container={env.app}>
    <I18nProvider>
      <ToastProvider>{node}</ToastProvider>
    </I18nProvider>
  </ServicesProvider>
);

describe('Task 17: the long refused line and Latin-script names', () => {
  it('Home "Submitted today" lets the refused line wrap (never a one-line phrase that clips at 320px)', async () => {
    const env = await refusedRecord();
    render(tree(env, <SubmittedToday />));
    const line = await screen.findByText('Not saved: someone else submitted this batch first.');
    expect(homeStyles.phrase).toBeTruthy();
    expect(line).not.toHaveClass(homeStyles.phrase);
    expect(line.closest(`.${homeStyles.phrase}`)).toBeNull();
  });

  it('RecordScreen keeps translated status text out of lang="en"; only the person\'s name is marked Latin', async () => {
    const env = setup();
    const instructor = await signIn(env.app, 'TR-10432');
    await verify(env.app, instructor, KEY);
    const roster = await env.app.services.attendance.openRoster(instructor, KEY);
    if (!roster.ok) throw new Error(roster.error);
    if (!(await env.app.services.attendance.submit(instructor, KEY, roster.value.marks)).ok) throw new Error('submit');
    signed.ctx = await signIn(env.app, 'PR-2741'); // the principal sees who submitted it
    render(tree(env, <RecordScreen />));
    const name = await screen.findByText('Rajesh Patil');
    expect(name).toHaveAttribute('lang', 'en');
    const strip = name.parentElement;
    expect(strip?.textContent).toMatch(/^Submitted · .+ · Rajesh Patil$/);
    expect(strip?.closest('span[lang="en"]')).toBeNull();
  });

  it('the refused line itself is not marked as English data', async () => {
    const env = await refusedRecord();
    render(tree(env, <RecordScreen />));
    const status = await screen.findByText('Not saved: someone else submitted this batch first.');
    expect(status.closest('span[lang="en"]')).toBeNull();
  });
});

