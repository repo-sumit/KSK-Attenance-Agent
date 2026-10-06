// @vitest-environment jsdom
/**
 * Offline for every user, the principal included (D-153): the waiting list names each record (own attendance, a staff
 * member's, a correction's student), Offline data without packs is the sync status only, the Reports entry says so,
 * the staff save says when it is only on this phone, and Home's sync card links to the list.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ToastProvider, ToastViewport } from '@/components/ui/Toast';
import { OfflineScreen } from '@/features/offline/OfflineScreen';
import { SyncPendingCard } from '@/features/offline/SyncPendingCard';
import { OfflineEntry } from '@/features/reports/sections/ReportLinks';
import { StaffScreen } from '@/features/staff/StaffScreen';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import type { ConfigLayer } from '@/config/types';
import type { SessionContext } from '@/services/context';
import { setup, signIn } from '../helpers/app';

const replace = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace, prefetch: vi.fn() }),
  usePathname: () => '/reports/offline',
  useSearchParams: () => new URLSearchParams(),
}));
const signed = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/hooks/session', () => ({
  useSession: () => signed.ctx,
  useJourney: () => (signed.ctx as SessionContext).journey,
}));
vi.mock('@/components/shell/ScreenLayout', () => ({
  ScreenLayout: ({ top, children, footer }: { top?: ReactNode; children?: ReactNode; footer?: ReactNode }) => (
    <main>
      {top}
      {children}
      {footer}
    </main>
  ),
}));
vi.mock('@/features/shell/AppHeader', () => ({ AppHeader: () => null }));

beforeAll(() => {
  // jsdom has no modal dialogs: open/close the element the way the browser would.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});
afterEach(() => {
  cleanup();
  replace.mockClear();
});

async function mount(trainerId: string, overrides: ConfigLayer = {}) {
  const env = setup(overrides);
  const ctx = await signIn(env.app, trainerId);
  signed.ctx = ctx;
  const view = (ui: ReactNode) =>
    render(
      <ServicesProvider container={env.app}>
        <I18nProvider>
          <ToastProvider>
            {ui}
            <ToastViewport />
          </ToastProvider>
        </I18nProvider>
      </ServicesProvider>,
    );
  return { env, ctx, view };
}

/** A label whose name sits in its own Latin span: matched on the whole text, at the innermost element. */
const whole = (text: string) => (_: string, el: Element | null) => el?.textContent === text && ![...el.children].some((c) => c.textContent === text);

describe('the waiting list names every record (D-153)', () => {
  it('the principal\'s offline staff marks read "Staff attendance · {name}"; a waiting correction reads "Correction · {student}"', async () => {
    const { env, ctx, view } = await mount('PR-2741');
    env.simulation.update({ online: false });
    await env.app.services.staffAttendance.markByPrincipal(ctx, [{ staffId: 'st-rajesh', status: 'absent' }]);
    const student = ctx.data.students[0];
    const queued = await env.app.services.sync.pendingItems();
    vi.spyOn(env.app.services.sync, 'pendingItems').mockResolvedValue([...queued, { id: 'c1', kind: 'correction', recordId: 'c1', label: student.id, enqueuedAt: ctx.clock.now().toISOString() }]);
    view(<OfflineScreen />);
    expect(await screen.findByText(whole('Staff attendance · Rajesh Patil'))).toBeTruthy();
    expect(screen.getByText(whole(`Correction · ${student.name}`))).toBeTruthy();
    expect(screen.queryByText('My attendance')).toBeNull();
    expect(screen.getByText(/are reported as missing for the day\./)).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
  });

  it('a record whose student or staff member is no longer in the data reads by its kind alone, never a raw id', async () => {
    const { env, ctx, view } = await mount('PR-2741');
    env.simulation.update({ online: false });
    await env.app.services.staffAttendance.markByPrincipal(ctx, [{ staffId: 'st-rajesh', status: 'absent' }]); // something waits
    const at = ctx.clock.now().toISOString();
    vi.spyOn(env.app.services.sync, 'pendingItems').mockResolvedValue([
      { id: 'c1', kind: 'correction', recordId: 'c1', label: 'stu-27410-ele-1-u2-07', enqueuedAt: at },
      { id: 's1', kind: 'staff_attendance', recordId: 's1', label: 'st-gone', enqueuedAt: at },
    ]);
    view(<OfflineScreen />);
    expect(await screen.findByText(whole('Correction'))).toBeTruthy();
    expect(screen.getByText(whole('Staff attendance'))).toBeTruthy();
    expect(screen.queryByText(/stu-27410-ele-1-u2-07/)).toBeNull();
    expect(screen.queryByText(/st-gone/)).toBeNull();
  });

  it('an instructor\'s own record still reads "My attendance"', async () => {
    const { env, ctx, view } = await mount('TR-10432');
    await env.app.services.verification.grant(ctx, { kind: 'self' });
    env.simulation.update({ online: false });
    expect((await env.app.services.staffAttendance.markSelf(ctx)).ok).toBe(true);
    view(<OfflineScreen />);
    expect(await screen.findByText('My attendance')).toBeTruthy();
  });
});

describe('Offline data without packs (principalCanMarkStudents off)', () => {
  it('is the sync status only: the calm synced banner, no downloaded-batches section, and the Reports entry says "Sync status"', async () => {
    const { view } = await mount('PR-2741', { identity: { principalCanMarkStudents: false } });
    view(<OfflineScreen />);
    expect(await screen.findByText('All attendance synced')).toBeTruthy();
    expect(screen.queryByText('Downloaded batches')).toBeNull();
    expect(screen.queryByText('No batches downloaded yet.')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    cleanup();
    view(<OfflineEntry />);
    expect(await screen.findByText('Sync status')).toBeTruthy();
    expect(screen.queryByText(/on this phone/)).toBeNull();
  });

  it('with packs the principal sees the downloaded batches and the entry counts them', async () => {
    const { view } = await mount('PR-2741');
    view(<OfflineScreen />);
    expect(await screen.findByText('Downloaded batches')).toBeTruthy();
    cleanup();
    view(<OfflineEntry />);
    expect(await screen.findByText(/batches on this phone/)).toBeTruthy();
  });
});

describe('staff saves say where they are (D-032)', () => {
  const saveRajesh = async () => {
    const row = (await screen.findByLabelText('Attendance for Rajesh Patil')) as HTMLSelectElement;
    fireEvent.change(row, { target: { value: 'present' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save 1 change' }));
    const sheet = document.querySelector('dialog[open]') as HTMLElement;
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save 1 change' }));
  };
  it('offline: "Saved on this phone · will sync automatically"', async () => {
    const { env, view } = await mount('PR-2741');
    env.simulation.update({ online: false });
    view(<StaffScreen />);
    await saveRajesh();
    expect(await screen.findByText('Saved on this phone · will sync automatically')).toBeTruthy();
  });
  it('online: "Staff attendance saved"', async () => {
    const { view } = await mount('PR-2741');
    view(<StaffScreen />);
    await saveRajesh();
    expect(await screen.findByText('Staff attendance saved')).toBeTruthy();
  });
});

describe('Home\'s Sync pending card links to the list', () => {
  const waiting = async (overrides: ConfigLayer = {}) => {
    const { env, ctx, view } = await mount('PR-2741', overrides);
    env.simulation.update({ online: false });
    await env.app.services.staffAttendance.markByPrincipal(ctx, [{ staffId: 'st-rajesh', status: 'absent' }]);
    await waitFor(() => expect(env.app.services.sync.status().pending).toBe(1));
    return view;
  };
  it('"See what\'s waiting" opens Offline data while offline is on', async () => {
    const view = await waiting();
    view(<SyncPendingCard />);
    const link = await screen.findByRole('link', { name: 'See what’s waiting' });
    expect(link.getAttribute('href')).toBe('/reports/offline');
  });
  it('absent with offline off, and on Offline data itself (the list is there)', async () => {
    const view = await waiting({ offline: { enabled: false } });
    view(<SyncPendingCard />);
    await screen.findByText('Sync pending');
    expect(screen.queryByText('See what’s waiting')).toBeNull();
    cleanup();
    view(<SyncPendingCard items={[]} />);
    await screen.findByText('Sync pending');
    expect(screen.queryByText('See what’s waiting')).toBeNull();
  });
});
