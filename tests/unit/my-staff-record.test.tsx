// @vitest-environment jsdom
/**
 * useMyStaffRecord (D-152): data still held for a previous key (staff self-marking turned on, another user) is not
 * today's answer, so the card never moves first on it.
 */
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { StaffAttendanceRecord } from '@/domain/attendance';
import { useMyStaffRecord } from '@/features/home/useMyStaffRecord';
import { ServicesProvider } from '@/hooks/services';
import type { SessionContext } from '@/services/context';
import { setup, signIn } from '../helpers/app';

const signed = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/hooks/session', () => ({ useSession: () => signed.ctx, useJourney: () => (signed.ctx as SessionContext).journey }));

const withSelfCard = (ctx: SessionContext, selfCard: boolean): SessionContext => ({
  ...ctx,
  journey: { ...ctx.journey, staff: { ...ctx.journey.staff, selfCard, selfFirst: true } },
});

describe('useMyStaffRecord', () => {
  it('a new key is not loaded until its own answer arrives (the old key’s data never moves the card first)', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    let release: (record: StaffAttendanceRecord | undefined) => void = () => undefined;
    const record = { staffId: ctx.user.id, date: '2026-09-25', status: 'present' } as unknown as StaffAttendanceRecord;
    vi.spyOn(env.app.services.staffAttendance, 'myRecord').mockImplementation(() => new Promise((resolve) => (release = resolve)));
    signed.ctx = withSelfCard(ctx, false);
    const wrapper = ({ children }: { readonly children: ReactNode }) => <ServicesProvider container={env.app}>{children}</ServicesProvider>;
    const { result, rerender } = renderHook(() => useMyStaffRecord(), { wrapper });
    await waitFor(() => expect(result.current.loaded).toBe(true));
    // Self-marking turned on: the old key's {record: undefined} is held while the record loads.
    signed.ctx = withSelfCard(ctx, true);
    rerender();
    await act(async () => undefined);
    expect(result.current.loaded).toBe(false);
    expect(result.current.selfFirst).toBe(false);
    expect(result.current.record).toBeUndefined();
    await act(async () => release(record));
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.record).toBe(record);
    expect(result.current.selfFirst).toBe(false);
  });
});
