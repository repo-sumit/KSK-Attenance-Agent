// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/Toast';
import { AtRiskSection } from '@/features/reports/sections/AtRiskSection';
import { BatchesSection } from '@/features/reports/sections/BatchesSection';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import type { SessionContext } from '@/services/context';
import { setup, signIn } from '../helpers/app';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/reports',
  useSearchParams: () => new URLSearchParams(),
}));
const signed = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/hooks/session', () => ({
  useSession: () => signed.ctx,
  useJourney: () => (signed.ctx as SessionContext).journey,
}));

const AT_RISK = 'At-risk students';
const scrolled: Element[] = [];
beforeAll(() => {
  // jsdom has no modal dialogs and no scrolling: record what the screen asks for.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolled.push(this);
  };
});
beforeEach(() => {
  scrolled.length = 0;
});
afterEach(cleanup);

/** Sanjay More (Fitter, Shift 1 Unit 1 and Shift 2 Unit 1) on Reports, as ReportsScreen lays the two sections out. */
async function mount(before?: (bus: ReturnType<typeof setup>['app']['services']['voiceBus']) => void) {
  const env = setup({ voice: { enabled: true } });
  signed.ctx = await signIn(env.app, 'TR-10455');
  const bus = env.app.services.voiceBus;
  before?.(bus);
  render(
    <ServicesProvider container={env.app}>
      <I18nProvider>
        <ToastProvider>
          <BatchesSection title="My batches" />
          <AtRiskSection />
        </ToastProvider>
      </I18nProvider>
    </ServicesProvider>,
  );
  await waitFor(() => expect(within(batches()).getAllByRole('button', { name: /Shift 2 · Unit 1/ }).length).toBeGreaterThan(0));
  return { env, bus };
}

/** The batches list (the at-risk list repeats batch names) and the at-risk section. */
const batches = () => screen.getByRole('region', { name: 'My batches' });
const atRisk = () => screen.getByRole('region', { name: AT_RISK });
const batchToggle = (name: RegExp) => within(batches()).getByRole('button', { name, expanded: true });

describe('Reports follows voice (D-140): typed bus events, the screen owns its state', () => {
  it('show_batch_report expands that batch\'s row and scrolls it into view', async () => {
    const { bus } = await mount();
    act(() => void bus.emit({ type: 'show_batch_report', batchId: 'fit-s2u1' }));
    await waitFor(() => expect(batchToggle(/Shift 2 · Unit 1/)).toBeInTheDocument());
    expect(scrolled.some((el) => el.contains(batchToggle(/Shift 2 · Unit 1/)))).toBe(true);
    expect(within(batches()).getByRole('button', { name: /Shift 1 · Unit 1/, expanded: false })).toBeInTheDocument();
  });

  it('a Reports screen that mounts after voice asked (the same navigation) still shows the batch', async () => {
    await mount((bus) => {
      bus.emit({ type: 'navigate', href: '/reports', replace: false });
      bus.emit({ type: 'show_batch_report', batchId: 'fit-s1u1' });
    });
    await waitFor(() => expect(batchToggle(/Shift 1 · Unit 1/)).toBeInTheDocument());
  });

  it('an older request is not replayed after voice navigated elsewhere', async () => {
    await mount((bus) => {
      bus.emit({ type: 'show_batch_report', batchId: 'fit-s1u1' });
      bus.emit({ type: 'navigate', href: '/home', replace: false });
    });
    expect(within(batches()).queryByRole('button', { name: /Shift 1 · Unit 1/, expanded: true })).toBeNull();
  });

  it('show_at_risk scrolls the at-risk section into view', async () => {
    const { bus } = await mount();
    act(() => void bus.emit({ type: 'show_at_risk' }));
    await waitFor(() => expect(scrolled).toContain(atRisk()));
  });

  it('open_register opens the sheet on the batch and the month voice chose; nothing downloads without a tap', async () => {
    const { bus } = await mount();
    act(() => void bus.emit({ type: 'open_register', batchIds: ['fit-s1u1'], tradeId: null, month: '2026-08-01' }));
    const sheet = await screen.findByRole('dialog', { name: 'Download attendance register' });
    expect(sheet).toHaveTextContent('Fitter · Shift 1 · Unit 1');
    expect(within(sheet).getByRole('radio', { checked: true })).toHaveAttribute('value', '2026-08-01');
    expect(within(sheet).getByRole('button', { name: 'Download' })).toBeEnabled();
  });

  it('open_register for a trade opens the trade register on this month', async () => {
    const { bus } = await mount();
    act(() => void bus.emit({ type: 'open_register', batchIds: ['fit-s1u1', 'fit-s2u1'], tradeId: 'fit', month: '2026-09-01' }));
    const sheet = await screen.findByRole('dialog', { name: 'Download attendance register' });
    expect(sheet).toHaveTextContent('Fitter');
    expect(sheet).not.toHaveTextContent('Shift');
    expect(within(sheet).getByRole('radio', { checked: true })).toHaveAttribute('value', '2026-09-01');
  });

  it('a second open_register while the sheet is open ("no, last month") selects the new month', async () => {
    const { bus } = await mount();
    act(() => void bus.emit({ type: 'open_register', batchIds: ['fit-s1u1'], tradeId: null, month: '2026-09-01' }));
    let sheet = await screen.findByRole('dialog', { name: 'Download attendance register' });
    expect(within(sheet).getByRole('radio', { checked: true })).toHaveAttribute('value', '2026-09-01');
    act(() => void bus.emit({ type: 'open_register', batchIds: ['fit-s2u1'], tradeId: null, month: '2026-08-01' }));
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Download attendance register' })).toHaveTextContent('Fitter · Shift 2 · Unit 1'));
    sheet = screen.getByRole('dialog', { name: 'Download attendance register' });
    expect(within(sheet).getByRole('radio', { checked: true })).toHaveAttribute('value', '2026-08-01');
    expect(screen.getAllByRole('dialog', { name: 'Download attendance register' })).toHaveLength(1);
  });
  it('Task 15: open_register over a sheet the trainer opened by tap replaces it: one sheet, the latest request', async () => {
    const { bus } = await mount();
    fireEvent.click(within(batches()).getByRole('button', { name: 'Download register for Fitter · Shift 1 · Unit 1' }));
    expect(screen.getByRole('dialog', { name: 'Download attendance register' })).toHaveTextContent('Fitter · Shift 1 · Unit 1');
    act(() => void bus.emit({ type: 'open_register', batchIds: ['fit-s2u1'], tradeId: null, month: '2026-08-01' }));
    await waitFor(() => expect(screen.getAllByRole('dialog', { name: 'Download attendance register' })).toHaveLength(1));
    const sheet = screen.getByRole('dialog', { name: 'Download attendance register' });
    expect(sheet).toHaveTextContent('Fitter · Shift 2 · Unit 1');
    expect(within(sheet).getByRole('radio', { checked: true })).toHaveAttribute('value', '2026-08-01');
  });

  it('Task 17: closing the sheet voice opened returns focus to that batch\'s register button', async () => {
    const { bus } = await mount();
    act(() => void bus.emit({ type: 'open_register', batchIds: ['fit-s2u1'], tradeId: null, month: '2026-09-01' }));
    const sheet = await screen.findByRole('dialog', { name: 'Download attendance register' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Download attendance register' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(batches()).getByRole('button', { name: 'Download register for Fitter · Shift 2 · Unit 1' })));
  });

  it('Task 17 fix round 1: with no register button for the request, focus goes to the section heading (focusable by its own props)', async () => {
    const { bus } = await mount();
    const heading = within(batches()).getByRole('heading', { level: 2, name: 'My batches' });
    expect(heading).toHaveAttribute('tabindex', '-1'); // rendered so, not added from script
    // A batch of the institute that is not in Sanjay's list: no row, so no register button to return to.
    act(() => void bus.emit({ type: 'open_register', batchIds: ['ele-s1u1'], tradeId: null, month: '2026-09-01' }));
    const sheet = await screen.findByRole('dialog', { name: 'Download attendance register' });
    expect(within(batches()).queryByRole('button', { name: /Download register for Electrician/ })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Download attendance register' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(heading).toHaveAttribute('tabindex', '-1');
  });

  it('Task 17: and for a trade request, to the trade\'s register button', async () => {
    const { bus } = await mount();
    act(() => void bus.emit({ type: 'open_register', batchIds: ['fit-s1u1', 'fit-s2u1'], tradeId: 'fit', month: '2026-09-01' }));
    const sheet = await screen.findByRole('dialog', { name: 'Download attendance register' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(document.activeElement).toBe(within(batches()).getByRole('button', { name: 'Trade register: Fitter' })));
  });
});
