import { describe, expect, it } from 'vitest';
import type { StaffAttendanceRecord } from '@/domain/attendance';
import { canReuseSelfPass, checkSelfFirst, type PassChecks } from '@/domain/rules';
import { instantAt } from '@/lib/time';
import { TODAY } from '../../helpers/fixtures';

const record = (source: 'self' | 'principal', status: 'present' | 'absent' = 'present'): StaffAttendanceRecord => ({
  id: 'staff-1',
  staffId: 'st-rajesh',
  date: TODAY,
  status,
  source,
  markedBy: source === 'self' ? 'st-rajesh' : 'st-anil',
  deviceTimestamp: instantAt(TODAY, '10:00').toISOString(),
  syncState: 'pending',
});

describe('own attendance before students (D-152)', () => {
  it('refuses self_first while the rule is on and there is no own record today', () => {
    expect(checkSelfFirst({ required: true, ownRecordToday: undefined })).toMatchObject({ ok: false, error: 'self_first' });
  });
  it('lets any own record today through, the principal’s mark included', () => {
    expect(checkSelfFirst({ required: true, ownRecordToday: record('self') }).ok).toBe(true);
    expect(checkSelfFirst({ required: true, ownRecordToday: record('principal', 'absent') }).ok).toBe(true);
  });
  it('never refuses when the rule is off', () => {
    expect(checkSelfFirst({ required: false, ownRecordToday: undefined }).ok).toBe(true);
  });
});

describe('a recent self pass opens a batch (D-152, amends D-028)', () => {
  const both: PassChecks = { location: 'fence', face: true };
  const pass = (at: string, checks: PassChecks | null = both, date = TODAY) => ({ date, grantedAt: instantAt(date, at).toISOString(), ...(checks ? { checks } : {}) });
  const reuse = (p: ReturnType<typeof pass> | { date: string; grantedAt?: string; checks?: PassChecks } | undefined, at = '10:15', opts: { minutes?: number; needs?: PassChecks } = {}) =>
    canReuseSelfPass({ pass: p, needs: opts.needs ?? both, now: instantAt(TODAY, at), today: TODAY, minutes: opts.minutes ?? 10 });

  it('reuses a pass from today no older than the configured minutes', () => {
    expect(reuse(pass('10:05'))).toBe(true);
    expect(reuse(pass('10:15'))).toBe(true);
  });
  it('not after the window', () => {
    expect(reuse(pass('10:04'))).toBe(false);
    expect(reuse(pass('10:15'), '10:26')).toBe(false);
  });
  it('not across days', () => {
    const yesterday = { date: '2026-09-24', grantedAt: instantAt('2026-09-24', '23:58').toISOString(), checks: both };
    expect(reuse(yesterday, '00:03')).toBe(false);
  });
  it('not when the batch needs a check the self pass did not include', () => {
    expect(reuse(pass('10:10', { location: 'fence', face: false }))).toBe(false);
    expect(reuse(pass('10:10', { location: 'background', face: true }))).toBe(false);
    expect(reuse(pass('10:10', { location: 'none', face: true }), '10:15', { needs: { location: 'background', face: true } })).toBe(false);
    // a stricter self check covers a lighter batch check
    expect(reuse(pass('10:10', { location: 'fence', face: true }), '10:15', { needs: { location: 'background', face: false } })).toBe(true);
  });
  it('never without a time or the checks it covered, never from the future, never with 0 minutes', () => {
    expect(reuse({ date: TODAY, checks: both })).toBe(false);
    expect(reuse({ date: TODAY, grantedAt: 'not a time', checks: both })).toBe(false);
    expect(reuse(pass('10:10', null))).toBe(false);
    expect(reuse(pass('10:20'))).toBe(false);
    expect(reuse(pass('10:15'), '10:15', { minutes: 0 })).toBe(false);
    expect(reuse(undefined)).toBe(false);
  });
});
