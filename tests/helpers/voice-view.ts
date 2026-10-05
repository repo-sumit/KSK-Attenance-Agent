/**
 * A small hand-made voice view for the instruction and [APP] event tests: Electrician, Shift 1, Unit 2
 * with three students (Rohan is on OJT), a session card literal and the Maharashtra-like flow plan.
 */
import { toSessionKey, type MarkingSlot } from '@/domain/attendance';
import type { Batch, ShiftNo, Student, TimeWindow, Trade } from '@/domain/entities';
import type { Mark } from '@/domain/status';
import type { VoiceFlowState } from '@/domain/voice/flow';
import type { FlowPlan, VoiceCapabilities, VoicePlan } from '@/domain/voice/plan';
import type { MarkSource } from '@/domain/voice/types';
import type { SessionCard, SessionStatus } from '@/services/attendance';
import type { DraftSnapshot } from '@/services/marking-draft';
import type { VoiceView } from '@/services/voice/instructions';

export const DATE = '2026-10-03';

export const PLAN: FlowPlan = {
  selection: 'trade_picker', tradeStep: true, slotWords: 'once',
  verification: { location: 'fence', face: true, required: true },
  defaultStatus: 'present', startStyle: 'exceptions', rollCallSwitch: true,
  statuses: ['present', 'absent', 'leave'], ojtVisible: true,
  details: { half: false, leaveType: true, leaveDays: true },
  languages: ['en', 'mr'], openingLanguage: 'en', timeFencing: true,
};

/** An instructor's capabilities in the Maharashtra demo (D-139). */
export const CAPS: VoiceCapabilities = {
  selfAttendance: true, reports: 'instructor', reportSections: { batches: true, atRisk: true, institute: false }, staffMarking: false, staffStatuses: [],
  announcements: true, downloads: true, navTargets: ['home', 'reports', 'my_attendance', 'offline', 'announcements'],
};

/** The voice plan around a marking plan (an instructor): the languages are the marking plan's. */
export const voicePlan = (marking: FlowPlan = PLAN, capabilities: VoiceCapabilities = CAPS): VoicePlan => ({
  scope: 'instructor', marking, capabilities, languages: marking.languages, openingLanguage: marking.openingLanguage,
});

/** The principal: no marking flow, the institute's capabilities. */
export const PRINCIPAL_PLAN: VoicePlan = {
  scope: 'institute',
  marking: null,
  capabilities: {
    selfAttendance: false, reports: 'institute', reportSections: { batches: true, atRisk: true, institute: true }, staffMarking: true,
    staffStatuses: ['present', 'absent'], announcements: true, downloads: true, navTargets: ['home', 'attendance', 'reports', 'staff_attendance', 'announcements'],
  },
  languages: ['en', 'mr'],
  openingLanguage: 'en',
};

/** A blank-default state: a roll call calls every name. */
export const ROLL_PLAN: FlowPlan = { ...PLAN, defaultStatus: 'blank', startStyle: 'roll_call', rollCallSwitch: false };

export const ELECTRICIAN: Trade = { id: 'ele', instituteId: 'pune', name: 'Electrician', durationYears: 2 };
export const FITTER: Trade = { id: 'fit', instituteId: 'pune', name: 'Fitter', durationYears: 2 };

export const batch = (unit: number, shift: ShiftNo = 1): Batch => ({ id: `ele-s${shift}u${unit}`, tradeId: 'ele', shift, unit, year: 1 });

export const STUDENTS: readonly Student[] = [
  { id: 'S1', batchId: 'ele-s1u2', rollNo: 1, name: 'Aarav Patil', fatherName: 'Sunil Patil' },
  { id: 'S2', batchId: 'ele-s1u2', rollNo: 2, name: 'Aditi Shinde', fatherName: 'Ramesh Shinde' },
  { id: 'S3', batchId: 'ele-s1u2', rollNo: 3, name: 'Rohan Pawar', fatherName: 'Vijay Pawar' },
];

interface CardOptions {
  readonly slot?: MarkingSlot;
  readonly window?: TimeWindow | null;
  readonly status?: SessionStatus;
  readonly period?: 'theory' | 'practical';
}

export function card(b: Batch, o: CardOptions = {}): SessionCard {
  const slot = o.slot ?? { kind: 'daily' };
  const address = { batchId: b.id, date: DATE, slot };
  const window = o.window === undefined ? { start: '08:00', end: '14:00' } : o.window;
  const status = o.status ?? 'open';
  const entry =
    o.period && slot.kind === 'period' && window
      ? { timetableEntry: { id: `tt-${slot.periodNo}`, batchId: b.id, instructorId: 'TR-10377', weekday: 6, periodNo: slot.periodNo, kind: o.period, window } }
      : {};
  return {
    key: toSessionKey(address), address, batch: b, trade: ELECTRICIAN,
    scheduled: { slot, window, ...entry }, status, studentCount: 3, canMark: status === 'open', downloaded: false,
  };
}

export const CARD = card(batch(2));
export const KEY = CARD.key;

export const tap = (at = '2026-10-03T04:45:00.000Z'): MarkSource => ({ via: 'tap', at });
export const voice = (heard: string): MarkSource => ({ via: 'voice', at: '2026-10-03T04:45:00.000Z', heard });

export const PRESENT: Mark = { status: 'present' };
export const ABSENT: Mark = { status: 'absent' };
export const BLANK: Mark = { status: null };
export const OJT: Mark = { status: 'ojt' };

export function draft(
  marks: Readonly<Record<string, Mark>> = { S1: PRESENT, S2: PRESENT, S3: OJT },
  sources: Readonly<Record<string, MarkSource>> = {},
  presets: readonly string[] = ['S3'],
  students: readonly Student[] = STUDENTS,
): DraftSnapshot {
  return { key: KEY, students, marks, sources, presets: new Set(presets), revision: 1, locked: false };
}

export function flow(over: Partial<VoiceFlowState> = {}): VoiceFlowState {
  return { step: 'ROLL_CALL', tradeId: 'ele', sessionKey: KEY, currentId: null, skipped: [], rollCall: false, lastMarked: null, lastSkippedId: null, ...over };
}

export function view(over: Partial<VoiceView> = {}): VoiceView {
  return { plan: PLAN, flow: flow(), draft: draft(), card: CARD, trades: [ELECTRICIAN, FITTER], cards: [card(batch(1)), CARD], ...over };
}
