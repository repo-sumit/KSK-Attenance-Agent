import { describe, expect, it } from 'vitest';
import { screenSignal, voiceFingerprint } from '@/features/voice/screen-signal';
import { routes } from '@/lib/routes';

const q = (s: string) => new URLSearchParams(s);
describe('screenSignal', () => {
  it('maps every attendance route', () => {
    expect(screenSignal('/home', q(''))).toEqual({ kind: 'home' });
    expect(screenSignal('/attendance/trade', q('trade=ele'))).toEqual({ kind: 'trade', tradeId: 'ele' });
    for (const kind of ['open', 'mark', 'review', 'submitted', 'record'] as const)
      expect(screenSignal(`/attendance/${kind}`, q('s=ele-s1u2.2026-09-25.daily'))).toEqual({ kind, sessionKey: 'ele-s1u2.2026-09-25.daily' });
    expect(screenSignal('/reports', q(''))).toEqual({ kind: 'other', screen: 'reports' });
    expect(screenSignal('/reports/view', q('r=staff_summary'))).toEqual({ kind: 'other', screen: 'reports' });
    expect(screenSignal('/reports/offline', q(''))).toEqual({ kind: 'other', screen: 'offline' });
    expect(screenSignal('/attendance/staff', q(''))).toEqual({ kind: 'other', screen: 'staff_attendance' });
    expect(screenSignal('/attendance', q(''))).toEqual({ kind: 'other', screen: 'attendance' });
    expect(screenSignal('/face', q(''))).toEqual({ kind: 'other' });
    expect(screenSignal('/me/attendance', q(''))).toEqual({ kind: 'self' }); // My attendance (D-141)
    expect(screenSignal('/me/attendance/', q(''))).toEqual({ kind: 'self' });
    expect(screenSignal('/attendance/mark', q(''))).toEqual({ kind: 'other' });
  });
});

describe('the detail report route (Task 19)', () => {
  it('has one pathname constant, which the report links and the screen signal both use', () => {
    expect(routes.reportView).toBe('/reports/view');
    expect(routes.report('staff_summary', 'month')).toBe(`${routes.reportView}?r=staff_summary&range=month`);
    expect(screenSignal(routes.reportView, q('r=correction_log'))).toEqual({ kind: 'other', screen: 'reports' });
  });
});

describe('voiceFingerprint (Review Focus 2)', () => {
  it('ignores a rebuilt context with the same configuration, changes with the configuration or the user', async () => {
    const { setup, signIn } = await import('../../helpers/app');
    const env = setup({ voice: { enabled: true } });
    const a = await signIn(env.app, 'TR-10432');
    const b = (await env.app.services.session.load())!;   // a new SessionContext object, same configuration
    expect(b).not.toBe(a);
    expect(voiceFingerprint(b)).toBe(voiceFingerprint(a));
    env.setConfig({ voice: { enabled: true }, marking: { defaultStatus: 'blank' } });
    const c = (await env.app.services.session.load())!;
    expect(voiceFingerprint(c)).not.toBe(voiceFingerprint(a));
  });
});
