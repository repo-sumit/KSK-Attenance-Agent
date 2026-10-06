// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import summaryStyles from '@/components/ui/AttendanceSummary.module.css';
import cardStyles from '@/features/reports/sections/ReportSummaryCard.module.css';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { ToastProvider, ToastViewport } from '@/components/ui/Toast';
import type { ConfigLayer } from '@/config/types';
import { InstituteSection } from '@/features/reports/sections/InstituteSection';
import { buildReport } from '@/features/reports/reportRows';
import { MoreReports } from '@/features/reports/sections/ReportLinks';
import { StaffSection } from '@/features/reports/sections/StaffSection';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { createI18n } from '@/i18n';
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
vi.mock('@/features/reports/register/brandLogo', () => ({ brandLogo: () => Promise.resolve(undefined) }));

const UA = navigator.userAgent;
const EMBEDDED = 'Mozilla/5.0 (Linux; Android 13; SM-A146B Build/TP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36';
const scrolled: Element[] = [];
beforeAll(() => {
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
  vi.mocked(saveTextFile).mockReset().mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'userAgent', { value: UA, configurable: true });
});

/** Dr. Anil Deshmukh (principal) on the fixed clock (Fri 25 Sep 2026). */
async function mount(layer: ConfigLayer = {}, before?: (bus: ReturnType<typeof setup>['app']['services']['voiceBus']) => void, children?: React.ReactNode) {
  const env = setup(layer);
  signed.ctx = await signIn(env.app, 'PR-2741');
  const bus = env.app.services.voiceBus;
  before?.(bus);
  render(
    <ServicesProvider container={env.app}>
      <I18nProvider>
        <ToastProvider>
          {children ?? <StaffSection />}
          <ToastViewport />
        </ToastProvider>
      </I18nProvider>
    </ServicesProvider>,
  );
  return { env, bus };
}
const staff = () => screen.getByRole('region', { name: 'Staff attendance' });
/** The icon drawn inside an element: its first svg is the given icon's geometry. */
const drawsIcon = (el: Element | null | undefined, name: IconName) => {
  const reference = document.createElement('div');
  reference.innerHTML = renderToStaticMarkup(<Icon name={name} />);
  expect(el?.querySelector('svg')?.innerHTML).toBe(reference.querySelector('svg')?.innerHTML);
};
const loaded = () => waitFor(() => expect(within(staff()).getAllByRole('button', { expanded: false }).length).toBe(18));

describe('Staff attendance section (D-154)', () => {
  it('a headline for this month, one expandable row per staff member, lowest first, and the link to the detail report', async () => {
    await mount();
    await loaded();
    const section = staff();
    expect(section).toHaveTextContent('This month');
    expect(within(section).getByText('5 staff not marked today')).toBeInTheDocument();
    expect(within(section).getByText(/^Present: [\d.]+ days?$/)).toBeInTheDocument();
    expect(within(section).getByText(/^Absent: \d+ days?$/)).toBeInTheDocument();
    expect(within(section).getByText('Attendance').closest('div')).toHaveClass(cardStyles.withFacts);
    // Maharashtra's staff statuses are present and absent: no leave line.
    expect(within(section).queryByText(/^Leave:/)).toBeNull();
    expect(within(section).getAllByText('Not marked today')).toHaveLength(5);
    // The name is Latin master data, "(you)" the translated words around it.
    expect(within(section).getByText('Dr. Anil Deshmukh').closest('[lang="en"]')?.parentElement).toHaveTextContent(/^Dr\. Anil Deshmukh \(you\)$/);
    expect(within(section).getAllByText(/^\d+(\.\d)? of \d+ days$/).length).toBe(18);
    const link = within(section).getByRole('link', { name: 'Choose dates · print' });
    expect(link).toHaveAttribute('href', '/reports/view?r=staff_summary&range=month');
  });

  it('a row expands to its days as an attendance summary: Days, Present, Absent and Not marked, each with its icon (U8)', async () => {
    await mount();
    await loaded();
    // The principal (100%, every day marked): Not marked is neutral at 0, never amber.
    const you = within(staff()).getByText('Dr. Anil Deshmukh').closest('button')!;
    fireEvent.click(you);
    const panel = document.getElementById(you.getAttribute('aria-controls') ?? '')!;
    const tiles = [...panel.querySelectorAll('[data-summary-item]')];
    expect(tiles.map((tile) => tile.getAttribute('data-summary-item'))).toEqual(['total', 'present', 'absent', 'not_marked']);
    expect(tiles[0]).toHaveTextContent(/^\d+Days$/);
    for (const tile of tiles.slice(1)) expect(tile.querySelector('svg')).not.toBeNull();
    const notMarked = tiles[3];
    expect(notMarked).toHaveTextContent(/^0Not marked$/);
    expect(notMarked).toHaveClass(summaryStyles.neutral);
    expect(tiles[2]).toHaveClass(summaryStyles.error);
    drawsIcon(notMarked, 'circle');
  });

  it('"Not marked" carries the Not marked ring, never the below-threshold triangle (U12)', async () => {
    await mount();
    await loaded();
    drawsIcon(within(staff()).getByText('5 staff not marked today').closest('span'), 'circle');
    for (const line of within(staff()).queryAllByText(/^\d+ days? not marked$/)) drawsIcon(line.closest('span')?.parentElement, 'circle');
  });

  it("before anyone's day this month is recorded, the headline still says who is not marked today", async () => {
    const { env } = await mount();
    await loaded();
    cleanup();
    const overview = await env.app.services.reports.staffOverview(signed.ctx as SessionContext);
    vi.spyOn(env.app.services.reports, 'staffOverview').mockResolvedValue({ ...overview!, staffDays: 0, pct: null });
    render(
      <ServicesProvider container={env.app}>
        <I18nProvider>
          <StaffSection />
        </I18nProvider>
      </ServicesProvider>,
    );
    await loaded();
    expect(within(staff()).getByText('No attendance recorded this month yet.')).toBeInTheDocument();
    drawsIcon(within(staff()).getByText('5 staff not marked today').closest('span'), 'circle');
  });

  it('shows Leave when the staff status set has it, and a below-threshold chip names the staff threshold', async () => {
    await mount({ staff: { statusSet: ['present', 'absent', 'leave'] }, reports: { staffThresholdPct: 100 } });
    await loaded();
    expect(within(staff()).getByText(/^Leave: \d+ days?$/)).toBeInTheDocument();
    expect(within(staff()).getAllByText(/below 100%/).length).toBeGreaterThan(0);
  });

  it('"Staff register" opens the register sheet on the staff scope and downloads the staff register', async () => {
    const { env } = await mount();
    await loaded();
    const register = vi.spyOn(env.app.services.reports, 'staffRegister');
    fireEvent.click(within(staff()).getByRole('button', { name: 'Staff register' }));
    const sheet = screen.getByRole('dialog', { name: 'Download attendance register' });
    expect(sheet).toHaveTextContent('All staff · Government ITI Pune');
    expect(within(sheet).getAllByRole('radio')).toHaveLength(2);
    fireEvent.click(within(sheet).getByRole('radio', { name: 'August 2026' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Register downloaded'));
    expect(register).toHaveBeenCalledWith(signed.ctx, '2026-08-01');
    const [name, html] = vi.mocked(saveTextFile).mock.calls[0];
    expect(name).toBe('KSK-staff-register_2026-08.html');
    expect(html).toContain('Monthly Staff Attendance Register');
  });

  it('inside an Android WebView the staff register is refused too, and nothing is built', async () => {
    Object.defineProperty(navigator, 'userAgent', { value: EMBEDDED, configurable: true });
    const { env } = await mount();
    await loaded();
    const register = vi.spyOn(env.app.services.reports, 'staffRegister');
    fireEvent.click(within(staff()).getByRole('button', { name: 'Staff register' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Downloading isn’t available inside this app yet.'));
    expect(register).not.toHaveBeenCalled();
    expect(saveTextFile).not.toHaveBeenCalled();
  });

  it('no Staff register without reports.pdfDownload', async () => {
    await mount({ reports: { pdfDownload: false } });
    await loaded();
    expect(within(staff()).queryByRole('button', { name: 'Staff register' })).toBeNull();
  });
});

describe('Staff attendance follows voice (show_staff_report)', () => {
  it('scrolls the section into view and focuses its heading', async () => {
    const { bus } = await mount();
    await loaded();
    act(() => void bus.emit({ type: 'show_staff_report' }));
    await waitFor(() => expect(scrolled).toContain(staff()));
    expect(document.activeElement).toBe(within(staff()).getByRole('heading', { level: 2, name: 'Staff attendance' }));
  });

  it('a Reports screen that mounts after voice asked (the same navigation) still shows it', async () => {
    await mount({}, (bus) => {
      bus.emit({ type: 'navigate', href: '/reports', replace: false });
      bus.emit({ type: 'show_staff_report' });
    });
    await loaded();
    await waitFor(() => expect(scrolled).toContain(staff()));
  });

  it('an older request is not replayed after voice navigated elsewhere', async () => {
    await mount({}, (bus) => {
      bus.emit({ type: 'show_staff_report' });
      bus.emit({ type: 'navigate', href: '/home', replace: false });
    });
    await loaded();
    expect(scrolled).not.toContain(staff());
  });
});

describe('the staff register follows voice (open_staff_register, D-156)', () => {
  it('opens the register sheet on the staff scope and the month voice asked for; the principal taps Download', async () => {
    const { env, bus } = await mount();
    await loaded();
    const register = vi.spyOn(env.app.services.reports, 'staffRegister');
    act(() => void bus.emit({ type: 'open_staff_register', month: '2026-08-01' }));
    const sheet = await screen.findByRole('dialog', { name: 'Download attendance register' });
    expect(sheet).toHaveTextContent('All staff · Government ITI Pune');
    expect(within(sheet).getByRole('radio', { name: 'August 2026' })).toBeChecked();
    expect(saveTextFile).not.toHaveBeenCalled(); // nothing is downloaded without the tap
    fireEvent.click(within(sheet).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Register downloaded'));
    expect(register).toHaveBeenCalledWith(signed.ctx, '2026-08-01');
    expect(vi.mocked(saveTextFile).mock.calls[0][0]).toBe('KSK-staff-register_2026-08.html');
  });

  it('closing voice\'s sheet hands focus to the Staff register button', async () => {
    const { bus } = await mount();
    await loaded();
    act(() => void bus.emit({ type: 'open_staff_register', month: '2026-09-01' }));
    const sheet = await screen.findByRole('dialog', { name: 'Download attendance register' });
    expect(within(sheet).getByRole('radio', { checked: true })).toHaveAccessibleName(/^September 2026/);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(staff()).getByRole('button', { name: 'Staff register' })));
  });

  it('a Reports screen that mounts after voice asked still opens it; an older request is not replayed after voice navigated elsewhere', async () => {
    await mount({}, (bus) => {
      bus.emit({ type: 'navigate', href: '/reports', replace: false });
      bus.emit({ type: 'open_staff_register', month: '2026-08-01' });
    });
    await loaded();
    expect(await screen.findByRole('dialog', { name: 'Download attendance register' })).toBeInTheDocument();
    cleanup();
    await mount({}, (bus) => {
      bus.emit({ type: 'open_staff_register', month: '2026-08-01' });
      bus.emit({ type: 'navigate', href: '/home', replace: false });
    });
    await loaded();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no sheet without reports.pdfDownload', async () => {
    const { bus } = await mount({ reports: { pdfDownload: false } });
    await loaded();
    act(() => void bus.emit({ type: 'open_staff_register', month: '2026-08-01' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('one staff figure per page', () => {
  it('the Institute card drops its staff % while the staff section shows', async () => {
    await mount({}, undefined, <InstituteSection staffFigure={false} />);
    const institute = screen.getByRole('region', { name: 'Institute attendance' });
    await waitFor(() => expect(institute).toHaveTextContent('417 students'));
    expect(institute).not.toHaveTextContent('Staff attendance');
  });

  it('the Institute card has its siblings\' anatomy: a figure captioned Attendance, icon facts and the trend (U3)', async () => {
    await mount({}, undefined, <InstituteSection staffFigure={false} />);
    const institute = screen.getByRole('region', { name: 'Institute attendance' });
    await waitFor(() => expect(institute).toHaveTextContent('Last 3 months'));
    expect(within(institute).getByText('Attendance')).toBeInTheDocument();
    drawsIcon(within(institute).getByText('417 students').closest('span'), 'users');
    drawsIcon(within(institute).getByText('17 batches').closest('span'), 'layers');
    expect(within(institute).getAllByRole('listitem')).toHaveLength(3);
    // U11: a figure with facts is two grid columns at any width, whatever the facts' length in a language.
    expect(within(institute).getByText('Attendance').closest('div')).toHaveClass(cardStyles.withFacts);
  });

  it('a trend that fails never holds the headline back: the figure and facts show, without the trend', async () => {
    const env = setup();
    signed.ctx = await signIn(env.app, 'PR-2741');
    vi.spyOn(env.app.services.reports, 'instituteTrend').mockRejectedValue(new Error('offline, nothing cached'));
    render(
      <ServicesProvider container={env.app}>
        <I18nProvider>
          <InstituteSection staffFigure={false} />
        </I18nProvider>
      </ServicesProvider>,
    );
    const institute = screen.getByRole('region', { name: 'Institute attendance' });
    await waitFor(() => expect(institute).toHaveTextContent('417 students'));
    expect(within(institute).getByText('Attendance')).toBeInTheDocument();
    expect(institute).not.toHaveTextContent('Last 3 months');
  });

  it('and keeps it otherwise', async () => {
    await mount({}, undefined, <InstituteSection staffFigure />);
    const institute = screen.getByRole('region', { name: 'Institute attendance' });
    await waitFor(() => expect(institute).toHaveTextContent('Staff attendance'));
  });

  it('More reports leaves out the staff report while the section is on the page', async () => {
    await mount({}, undefined, <MoreReports onPage={['staff_summary']} />);
    const more = screen.getByRole('region', { name: 'More reports' });
    expect(within(more).getAllByRole('link')).toHaveLength(1);
    expect(within(more).getByRole('link')).toHaveTextContent('Correction log');
  });
});

describe('the staff detail report agrees with the card (U9)', () => {
  it('rows in the section\'s order, built like its rows: (you), role · trade, "n of m days", Absent N, Not marked N, and the %', async () => {
    const env = setup({ reports: { staffThresholdPct: 100 } });
    const ctx = await signIn(env.app, 'PR-2741');
    const range = env.app.services.reports.rangeFor(ctx, 'month');
    const data = await env.app.services.reports.build(ctx, 'staff_summary', range);
    const { t, format } = createI18n('en', 'en-IN');
    const { rows } = buildReport(t, format, ctx, data, range);
    expect(rows).toHaveLength(18);
    const overview = await env.app.services.reports.staffOverview(ctx);
    expect(rows.map((r) => r.id)).toEqual(overview?.staff.map((s) => s.member.id));
    for (const row of rows) {
      const parts = row.subtitle.map((p) => (typeof p === 'string' ? p : '')).filter(Boolean);
      expect(parts.slice(-3)).toEqual([expect.stringMatching(/^[\d.]+ of \d+ days$/), expect.stringMatching(/^Absent \d+$/), expect.stringMatching(/^Not marked \d+$/)]);
      expect(row.value).toMatch(/^(\d+%|—)$/);
    }
    const text = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>).replace(/<[^>]+>/g, '');
    const markup = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
    // Names and trades are Latin master data; "(you)" and the role are translated words.
    expect(markup(rows.find((r) => r.id === 'st-anil')?.title)).toBe('<span lang="en" dir="ltr">Dr. Anil Deshmukh</span> (you)');
    expect(markup(rows.find((r) => r.id === 'st-rajesh')?.subtitle[0])).toBe('Instructor · <span lang="en" dir="ltr">Electrician</span>');
    expect(text(rows.find((r) => r.id === 'st-rajesh')?.title)).toBe('Rajesh Patil');
    const staff = data.block === 'staff_summary' ? data.staff : [];
    for (const row of rows) expect(row.tone === 'warning').toBe(staff.find((s) => s.member.id === row.id)?.low);
  });
});
