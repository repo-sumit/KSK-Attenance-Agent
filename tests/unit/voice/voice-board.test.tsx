// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/Toast';
import { compileVoicePlan } from '@/domain/voice/plan';
import { AttendanceBoard } from '@/features/attendance/AttendanceBoard';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import type { AppContainer } from '@/services/container';
import { createExecutor } from '@/services/voice/executor';
import type { VoiceSession } from '@/services/voice/session';
import { TrainerTurns } from '@/services/voice/trainer-turns';
import { setup, signIn } from '../../helpers/app';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/home',
  useSearchParams: () => new URLSearchParams(),
}));
const signed = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/hooks/session', () => ({ useSession: () => signed.ctx }));

afterEach(cleanup);

/** Sanjay More (Fitter + Welder): the trade switcher, driven by the real executor on the container's own Action Bus. */
async function switcher() {
  const env = setup({ voice: { enabled: true }, mapping: { model: 'trade' }, verification: { geoMode: 'off', face: false }, time: { fencing: false } });
  const ctx = await signIn(env.app, 'TR-10455');
  signed.ctx = ctx;
  const plan = compileVoicePlan(ctx, 'en')!;
  expect(plan.marking!.selection).toBe('trade_switcher');
  const turns = new TrainerTurns();
  const ex = createExecutor({
    ctx, plan, bus: env.app.services.voiceBus,
    attendance: env.app.services.attendance, verification: env.app.services.verification, drafts: env.app.services.drafts,
    announcements: env.app.services.announcements, staffAttendance: env.app.services.staffAttendance, reports: env.app.services.reports,
    isOnline: () => true, nowMs: () => env.clock.now().getTime(), speechSeq: () => turns.counts.speechSeq, turnSeq: () => turns.counts.turnSeq,
    spokeAtTurn: () => turns.counts.spokeAtTurn, generation: () => 1, entropy: () => 0.42,
  });
  const call = (name: string, args: Record<string, unknown> = {}) => ex.execute({ id: name, name, args });
  return { env, ex, call };
}

const board = (app: AppContainer) =>
  render(
    <ServicesProvider container={app}>
      <I18nProvider>
        <ToastProvider>
          <AttendanceBoard />
        </ToastProvider>
      </I18nProvider>
    </ServicesProvider>,
  );

const shown = async () => {
  await waitFor(() => expect(screen.getByRole('radiogroup', { name: 'Trades' })).toBeInTheDocument());
  return screen.getByRole('radio', { checked: true }).textContent;
};

describe('AttendanceBoard: the trade voice chose survives the navigation to Home (F7)', () => {
  it('a board mounted after go_back pushed Home shows the batch’s trade (Welder), not the first trade', async () => {
    const { env, call } = await switcher();
    expect(await call('select_trade', { trade: 'welder' })).toMatchObject({ ok: true, trade: { id: 'wel' } });
    const opened = await call('select_batch', { batch: 'shift 2 unit 1' }); // Welder's shift 1 is submitted already
    expect(opened).toMatchObject({ ok: true });
    // The trainer is on the Welder list: no board is mounted while go_back pushes Home and shows the trade.
    expect(await call('go_back', { to: 'batch' })).toMatchObject({ ok: true, trade: { id: 'wel' } });
    const types = env.app.services.voiceBus.since(0).map((e) => e.type);
    expect(types.slice(-2)).toEqual(['navigate', 'show_trade']);
    board(env.app); // Home renders after the navigation
    expect(await shown()).toBe('Welder');
  });

  it('select_trade from a batch (navigate Home + show_trade in one tick) reaches the board that mounts afterwards', async () => {
    const { env, call } = await switcher();
    await call('select_trade', { trade: 'fitter' });
    expect(await call('select_batch', { batch: 'shift 1 unit 2' })).toMatchObject({ ok: true });
    expect(await call('select_trade', { trade: 'welder' })).toMatchObject({ ok: true, trade: { id: 'wel' } });
    board(env.app);
    expect(await shown()).toBe('Welder');
  });

  it('a show_trade the mounted board already handled is not replayed over a later tap when Home mounts again', async () => {
    const { env, call } = await switcher();
    const first = board(env.app);
    expect(await shown()).toBe('Fitter');
    await act(async () => {
      await call('select_trade', { trade: 'welder' }); // live, while the board is mounted
    });
    expect(await shown()).toBe('Welder');
    fireEvent.click(screen.getByRole('radio', { name: 'Fitter' })); // the trainer taps back to Fitter
    expect(await shown()).toBe('Fitter');
    first.unmount();
    board(env.app); // e.g. a tapped batch, then back to Home
    expect(await shown()).toBe('Fitter');
  });
});

describe('AttendanceBoard: the trade switcher and voice (U1, U3)', () => {
  it('a tapped trade reaches the running voice session as a trade screen signal (U1)', async () => {
    const { env } = await switcher();
    const onScreen = vi.fn();
    vi.spyOn(env.app.services.voice, 'current').mockReturnValue({ onScreen } as unknown as VoiceSession);
    board(env.app);
    expect(await shown()).toBe('Fitter');
    fireEvent.click(screen.getByRole('radio', { name: 'Welder' }));
    expect(await shown()).toBe('Welder');
    expect(onScreen).toHaveBeenCalledTimes(1);
    expect(onScreen).toHaveBeenCalledWith({ kind: 'trade', tradeId: 'wel' });
  });

  it('a tap with no voice session running changes the board only', async () => {
    const { env } = await switcher();
    board(env.app);
    expect(await shown()).toBe('Fitter');
    fireEvent.click(screen.getByRole('radio', { name: 'Welder' }));
    expect(await shown()).toBe('Welder');
  });

  it('a show_trade older than voice’s latest Home navigation is not replayed on a later mount (U3)', async () => {
    const { env, call } = await switcher();
    expect(await call('select_trade', { trade: 'welder' })).toMatchObject({ ok: true, trade: { id: 'wel' } }); // no board mounted: unhandled
    expect(await call('navigate', { to: 'reports' })).toMatchObject({ ok: true });
    expect(await call('navigate', { to: 'home' })).toMatchObject({ ok: true }); // voice shows Home again later
    board(env.app);
    expect(await shown()).toBe('Fitter'); // the stale choice is not replayed
  });
});
