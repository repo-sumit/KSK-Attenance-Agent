// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider, ToastViewport } from '@/components/ui/Toast';
import type { ConfigLayer } from '@/config/types';
import { BatchesSection } from '@/features/reports/sections/BatchesSection';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { saveTextFile } from '@/lib/download';
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
vi.mock('@/lib/download', () => ({ saveTextFile: vi.fn() }));
// The emblem is fetched from the app's own origin; jsdom has none, so the document is built without it.
vi.mock('@/features/reports/register/brandLogo', () => ({ brandLogo: () => Promise.resolve(undefined) }));

const UA = navigator.userAgent;
const EMBEDDED = 'Mozilla/5.0 (Linux; Android 13; SM-A146B Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36';

beforeAll(() => {
  // jsdom has no modal dialogs: open/close the element the way the browser would for these tests.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});
beforeEach(() => {
  vi.mocked(saveTextFile).mockReset().mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'userAgent', { value: UA, configurable: true });
});

/** Sanjay More (Fitter, 2 batches) on the fixed clock (Fri 25 Sep 2026): Reports → My batches. */
async function reports(layer: ConfigLayer = {}) {
  const env = setup(layer);
  const ctx = await signIn(env.app, 'TR-10455');
  signed.ctx = ctx;
  render(
    <ServicesProvider container={env.app}>
      <I18nProvider>
        <ToastProvider>
          <BatchesSection title="My batches" />
          <ToastViewport />
        </ToastProvider>
      </I18nProvider>
    </ServicesProvider>,
  );
  const batches = (await env.app.services.reports.batchOverview(ctx)).batches;
  await waitFor(() => expect(row(/Shift 1 · Unit 1/)).toBeInTheDocument());
  return { env, ctx, batches };
}

/** A batch row's toggle (the row's download button has no aria-expanded). */
const row = (name: RegExp) => screen.getByRole('button', { name, expanded: false });
const expand = async (name: RegExp) => {
  fireEvent.click(row(name));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Hide students' })).toBeInTheDocument());
};

const sheet = () => screen.getByRole('dialog', { name: 'Download attendance register' });
const toast = async (text: string) => waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(text));

describe('register download (D-137): entry points behind reports.pdfDownload', () => {
  it('one Trade register button per trade group, and Download register in an expanded batch', async () => {
    const { batches } = await reports();
    const trades = new Set(batches.map((b) => b.trade.id));
    expect(screen.getAllByRole('button', { name: /^Trade register/ })).toHaveLength(trades.size);
    expect(screen.getByRole('button', { name: 'Trade register: Fitter' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Download register' })).toBeNull();
    await expand(/Shift 1 · Unit 1/);
    expect(screen.getByRole('button', { name: 'Download register' })).toBeInTheDocument();
  });

  it('absent when pdfDownload is off (a capability, never a role)', async () => {
    await reports({ reports: { pdfDownload: false } });
    expect(screen.queryByRole('button', { name: /^Trade register/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Download register for / })).toBeNull();
    await expand(/Shift 1 · Unit 1/);
    expect(screen.queryByRole('button', { name: 'Download register' })).toBeNull();
  });
});

describe('register download on each batch row (owner follow-up): one tap from the collapsed list', () => {
  it('every batch row has an icon button named with its trade and batch, with the same text as its tooltip', async () => {
    const { batches } = await reports();
    const buttons = screen.getAllByRole('button', { name: /^Download register for / });
    expect(buttons.map((b) => b.getAttribute('aria-label')).sort()).toEqual(
      batches.map((b) => `Download register for ${b.trade.name} · Shift ${b.batch.shift} · Unit ${b.batch.unit}`).sort(),
    );
    const s1u1 = screen.getByRole('button', { name: 'Download register for Fitter · Shift 1 · Unit 1' });
    expect(s1u1).toHaveAttribute('title', 'Download register for Fitter · Shift 1 · Unit 1');
    // Icon only: the name is the label, the icon is decoration.
    expect(s1u1).toHaveTextContent('');
    expect(s1u1.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('opens the sheet for that one batch while the row stays collapsed, and downloads only that batch', async () => {
    const { env, ctx } = await reports();
    const register = vi.spyOn(env.app.services.reports, 'register');
    const opener = screen.getByRole('button', { name: 'Download register for Fitter · Shift 1 · Unit 1' });
    opener.focus();
    fireEvent.click(opener);
    expect(sheet()).toHaveTextContent('Fitter · Shift 1 · Unit 1');
    expect(row(/Shift 1 · Unit 1/)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Hide students' })).toBeNull();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Download' }));
    await toast('Register downloaded');
    expect(register).toHaveBeenCalledWith(ctx, { batchIds: ['fit-s1u1'], month: '2026-09-01' });
    expect(vi.mocked(saveTextFile).mock.calls[0][0]).toBe('KSK-register_fitter_S1-U1_2026-09.html');
    expect(opener).toHaveFocus();
    expect(row(/Shift 1 · Unit 1/)).toHaveAttribute('aria-expanded', 'false');
  });

  it('the expanded batch still ends with its Download register button', async () => {
    await reports();
    await expand(/Shift 1 · Unit 1/);
    expect(screen.getByRole('button', { name: 'Download register' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download register for Fitter · Shift 1 · Unit 1' })).toBeInTheDocument();
  });
});

describe('register download sheet', () => {
  it('lists this month (so far) and last month, and downloads the chosen month of the batch', async () => {
    const { env, ctx } = await reports();
    const register = vi.spyOn(env.app.services.reports, 'register');
    await expand(/Shift 1 · Unit 1/);
    fireEvent.click(screen.getByRole('button', { name: 'Download register' }));
    const dialog = sheet();
    expect(dialog).toHaveTextContent('Fitter · Shift 1 · Unit 1');
    const group = within(dialog).getByRole('group', { name: 'Month' });
    const months = within(group).getAllByRole('radio');
    expect(months.map((m) => m.closest('label')?.textContent)).toEqual(['September 2026 · 1–25 Sep so far', 'August 2026']);
    expect(months[0]).toBeChecked();
    expect(dialog).toHaveTextContent('An HTML file that opens in any browser. To keep a PDF, open it and choose Print, then Save as PDF.');

    fireEvent.click(within(group).getByRole('radio', { name: 'August 2026' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download' }));
    await toast('Register downloaded');
    expect(register).toHaveBeenCalledWith(ctx, { batchIds: ['fit-s1u1'], month: '2026-08-01' });
    expect(saveTextFile).toHaveBeenCalledTimes(1);
    const [name, html] = vi.mocked(saveTextFile).mock.calls[0];
    expect(name).toMatch(/^KSK-register_fitter_S1-U1_2026-08\.html$/);
    expect(html).toContain('Monthly Attendance Register');
    expect(html).toContain('August 2026');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the trade button builds one register of that trade’s batches in this list, with the trade summary', async () => {
    const { env, ctx, batches } = await reports();
    const register = vi.spyOn(env.app.services.reports, 'register');
    fireEvent.click(screen.getByRole('button', { name: 'Trade register: Fitter' }));
    expect(sheet()).toHaveTextContent('Fitter');
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Download' }));
    await toast('Register downloaded');
    const ids = batches.filter((b) => b.trade.id === 'fit').map((b) => b.batch.id);
    expect(ids.length).toBeGreaterThan(1);
    expect(register).toHaveBeenCalledWith(ctx, { batchIds: ids, month: '2026-09-01' });
    const [name, html] = vi.mocked(saveTextFile).mock.calls[0];
    expect(name).toBe('KSK-register_fitter_2026-09.html');
    expect(html).toContain('Trade summary');
  });

  it('inside an Android WebView it explains instead of trying, and nothing is built or saved', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: EMBEDDED, configurable: true });
    const { env } = await reports();
    const register = vi.spyOn(env.app.services.reports, 'register');
    fireEvent.click(screen.getByRole('button', { name: 'Trade register: Fitter' }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Download' }));
    await toast('Downloading isn’t available inside this app yet. Open KSK Attendance in a browser to download.');
    expect(register).not.toHaveBeenCalled();
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  it('Task 15: a browser that cannot save a file (saveTextFile false outside a WebView) gets the problem message, not the in-app one', async () => {
    vi.mocked(saveTextFile).mockReturnValue(false);
    await reports();
    fireEvent.click(screen.getByRole('button', { name: 'Trade register: Fitter' }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Download' }));
    await toast('Couldn’t prepare this register. Try again.');
    expect(saveTextFile).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/inside this app/)).toBeNull();
  });

  it('a register out of scope (null) says so, with no save and no console error', async () => {
    const { env } = await reports();
    const errors = vi.spyOn(console, 'error');
    vi.spyOn(env.app.services.reports, 'register').mockResolvedValue(null);
    fireEvent.click(screen.getByRole('button', { name: 'Trade register: Fitter' }));
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Download' }));
    await toast('Couldn’t prepare this register. Try again.');
    expect(saveTextFile).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  });

  it('shows Preparing… while it builds, and Cancel returns focus to the button that opened it', async () => {
    const { env } = await reports();
    let finish: (value: null) => void = () => undefined;
    vi.spyOn(env.app.services.reports, 'register').mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const opener = screen.getByRole('button', { name: 'Trade register: Fitter' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Download' }));
    const busy = await within(sheet()).findByRole('button', { name: 'Preparing…' });
    expect(busy).toHaveAttribute('aria-disabled', 'true');
    expect(within(sheet()).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    finish(null);
    await toast('Couldn’t prepare this register. Try again.');
    expect(opener).toHaveFocus();
  });
});

describe('saveTextFile and isEmbeddedWebView', () => {
  it('saves through a temporary download link and revokes the object URL after 30 s', async () => {
    const { saveTextFile: save } = await vi.importActual<typeof import('@/lib/download')>('@/lib/download');
    vi.useFakeTimers();
    // Spies, restored below: the real URL statics must reach later tests unchanged.
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:register');
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const clicked: { download: string; href: string }[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    });
    try {
      expect(save('KSK-register_x_2026-09.html', '<p>x</p>')).toBe(true);
      expect(clicked).toEqual([{ download: 'KSK-register_x_2026-09.html', href: 'blob:register' }]);
      expect(created.mock.calls[0]).toHaveLength(1);
      expect(document.querySelector('a[download]')).toBeNull();
      vi.advanceTimersByTime(29_999);
      expect(revoked).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(revoked).toHaveBeenCalledWith('blob:register');
    } finally {
      vi.useRealTimers();
      created.mockRestore();
      revoked.mockRestore();
      click.mockRestore();
    }
    expect(vi.isMockFunction(URL.createObjectURL)).toBe(false);
    expect(vi.isMockFunction(URL.revokeObjectURL)).toBe(false);
  });

  it('inside an embedded WebView nothing is attempted', async () => {
    const { saveTextFile: save } = await vi.importActual<typeof import('@/lib/download')>('@/lib/download');
    const { isEmbeddedWebView } = await import('@/lib/platform');
    expect(isEmbeddedWebView()).toBe(false);
    Object.defineProperty(navigator, 'userAgent', { value: EMBEDDED, configurable: true });
    expect(isEmbeddedWebView()).toBe(true);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    expect(save('a.html', 'x')).toBe(false);
    expect(click).not.toHaveBeenCalled();
    click.mockRestore();
  });
});
