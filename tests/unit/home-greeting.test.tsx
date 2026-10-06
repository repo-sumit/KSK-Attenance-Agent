// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/Toast';
import type { ConfigLayer } from '@/config/types';
import { InstructorHome } from '@/features/home/InstructorHome';
import { PrincipalHome } from '@/features/home/PrincipalHome';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { FixedClock, instantAt } from '@/lib/time';
import type { SessionContext } from '@/services/context';
import { TODAY } from '../helpers/fixtures';
import { setup, signIn } from '../helpers/app';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/home', useSearchParams: () => new URLSearchParams() }));
const signed = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/hooks/session', () => ({ useSession: () => signed.ctx, useJourney: () => (signed.ctx as SessionContext).journey }));
vi.mock('@/components/shell/ScreenLayout', () => ({ ScreenLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/features/shell/AppHeader', () => ({ AppHeader: () => null }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.documentElement.lang = '';
});

const at = (time: string) => instantAt(TODAY, time);

interface MountOptions {
  readonly who?: string;
  readonly wall?: string;
  readonly language?: 'en' | 'mr';
  readonly config?: ConfigLayer;
  readonly before?: (env: ReturnType<typeof setup>, ctx: SessionContext) => void;
}

/** A Home on the demo clock (10:15) with the real time of day at `wall`. */
async function mount({ who = 'TR-10432', wall = '14:30', language = 'en', config = {}, before }: MountOptions = {}) {
  const wallClock = new FixedClock(at(wall));
  const env = setup(config, { wallClock });
  const ctx = await signIn(env.app, who);
  signed.ctx = ctx;
  if (language === 'mr') await env.app.repositories.preferences.setLanguage('mr');
  before?.(env, ctx);
  const Home = ctx.journey.isPrincipal ? PrincipalHome : InstructorHome;
  render(
    <ServicesProvider container={env.app}>
      <I18nProvider>
        <ToastProvider>
          <Home />
        </ToastProvider>
      </I18nProvider>
    </ServicesProvider>,
  );
  return { env, ctx, wallClock };
}

describe('the Home greeting follows the real time of day (D-151)', () => {
  it('"Good afternoon, Rajesh" with the wall clock at 14:30 while the demo clock says 10:15', async () => {
    const { ctx } = await mount({ wall: '14:30' });
    expect(ctx.clock.now()).toEqual(at('10:15'));
    expect(await screen.findByRole('heading', { level: 2, name: 'Good afternoon, Rajesh' })).toBeInTheDocument();
  });

  it('"Good night" late in the evening', async () => {
    await mount({ wall: '21:30' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Good night, Rajesh' })).toBeInTheDocument();
  });

  it('the trainer’s name is Latin master data inside a Marathi greeting', async () => {
    await mount({ wall: '14:30', language: 'mr' });
    const heading = await screen.findByRole('heading', { level: 2, name: 'शुभ दुपार, Rajesh' });
    const name = heading.querySelector('[lang="en"]');
    expect(name?.textContent).toBe('Rajesh');
    expect(heading.textContent).toBe('शुभ दुपार, Rajesh');
  });

  it('the principal is greeted by the translated salutation, not as Latin master data', async () => {
    await mount({ who: 'PR-2741', wall: '18:00', language: 'mr' });
    const heading = await screen.findByRole('heading', { level: 2, name: 'शुभ संध्याकाळ, प्राचार्य' });
    expect(heading.querySelector('[lang="en"]')).toBeNull();
  });

  it('refreshes when the day part changes while Home is open', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { wallClock } = await mount({ wall: '16:59' });
    expect(await screen.findByRole('heading', { level: 2, name: 'Good afternoon, Rajesh' })).toBeInTheDocument();
    wallClock.set(at('17:00'));
    act(() => void vi.advanceTimersByTime(60_000));
    expect(screen.getByRole('heading', { level: 2, name: 'Good evening, Rajesh' })).toBeInTheDocument();
  });
});

describe('My attendance on Home while own attendance first is on (D-152)', () => {
  const ruleOn: ConfigLayer = { staff: { selfBeforeStudents: true } };

  it('while the record loads, its placeholder holds the top slot (no jump for an unmarked trainer)', async () => {
    await mount({ config: ruleOn, before: (env) => void vi.spyOn(env.app.services.staffAttendance, 'myRecord').mockReturnValue(new Promise(() => {})) });
    const heading = await screen.findByRole('heading', { level: 2, name: 'Good afternoon, Rajesh' });
    const today = await screen.findByRole('region', { name: 'Today’s attendance' });
    // The first loading placeholder after the greeting, outside today's classes, is My attendance's: it sits above them.
    const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const placeholder = [...document.querySelectorAll('[aria-busy="true"]')].find((el) => follows(heading, el) && !today.contains(el));
    expect(placeholder).toBeDefined();
    expect(placeholder).toHaveTextContent('Loading');
    expect(follows(placeholder!, today)).toBe(true);
    expect(screen.queryByText('My attendance')).toBeNull(); // the card itself waits for the record
  });

  it('a failed read still settles: the card says Not marked instead of loading for ever', async () => {
    await mount({ config: ruleOn, before: (env) => void vi.spyOn(env.app.services.staffAttendance, 'myRecord').mockRejectedValue(new Error('offline')) });
    expect(await screen.findByText('My attendance')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Not marked')).toBeInTheDocument());
  });
});
