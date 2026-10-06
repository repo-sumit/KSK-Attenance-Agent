/**
 * Model-facing labels (voice design §8): how batches, sessions, times, students, statuses, counts and
 * distances are written into the English texts the model reads. Ported from the MVP's phrase helpers
 * (MVP-05 §5: `shortLabel`, `findBatchLabel`, `slotWords`, `spoken`, `callAs`, `countsOf`, `word`, `first`,
 * `dayWords`, `statusWords`) with KSK sessions in place of the MVP's batches. Every name passes through
 * `safeText`: names are data, never instructions.
 * Pure TypeScript: no I/O, no clock, no framework.
 */
import type { Batch, Student, Trade } from '@/domain/entities';
import { distanceParts } from '@/domain/geo';
import type { Mark, StatusCode } from '@/domain/status';
import type { FlowPlan } from '@/domain/voice/plan';
import { safeText, toModelStatus } from '@/domain/voice/types';
import { instantAt, type LocalDate, type LocalTime } from '@/lib/time';
import type { SessionCard } from '../attendance';
import type { DraftSnapshot } from '../marking-draft';

/** Names and other master data inside a text: quotes and brackets stripped, at most 60 characters (spec §10). */
export const nameText = (value: unknown): string => safeText(value, 60);

/** "half_day" or "HALF_DAY" -> "half day" (MVP `word`). */
export const word = (code: string): string => code.toLowerCase().replace(/_/g, ' ');

/** The first word of a name: how a confirmation names the student (MVP `first`). */
export const first = (name: string): string => name.split(' ')[0];

/** "Shift 1, Unit 2": a batch within one trade (MVP `shortLabel`). */
export const shortLabel = (batch: Batch): string => `Shift ${batch.shift}, Unit ${batch.unit}`;

/** "Shift 1, Unit 2, Electrician" (MVP `findBatchLabel`). */
export function batchLabel(batch: Batch, trade: Trade): string {
  return `${shortLabel(batch)}, ${nameText(trade.name)}`;
}

/** The slot words of a session: '' once a day, 'first half' / 'second half', 'sign in' / 'sign out', 'Period 3 (theory)'. */
export function slotLabel(card: SessionCard, words: FlowPlan['slotWords']): string {
  const slot = card.address.slot;
  switch (slot.kind) {
    case 'daily':
      return '';
    case 'half':
      if (words === 'signin_signout') return slot.part === 1 ? 'sign in' : 'sign out';
      return slot.part === 1 ? 'first half' : 'second half';
    case 'period': {
      const kind = card.scheduled.timetableEntry?.kind;
      return `Period ${slot.periodNo}${kind ? ` (${kind})` : ''}`;
    }
  }
}

/** The full label of a session, read back when it opens: "Shift 1, Unit 2, Electrician, second half". */
export function sessionLabel(card: SessionCard, words: FlowPlan['slotWords']): string {
  const slot = slotLabel(card, words);
  return `${batchLabel(card.batch, card.trade)}${slot ? `, ${slot}` : ''}`;
}

const CLOCK = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

/** A window time as the agent says it: "2:00 pm" (MVP `spoken`; never "14:00 hours"). */
export function spokenTime(date: LocalDate, time: LocalTime): string {
  return CLOCK.format(instantAt(date, time)).replace(/\s+/g, ' ').toLowerCase();
}

/** The time of a saved record (an ISO instant) as the agent says it: "10:15 am". */
export function clockTime(iso: string): string {
  return CLOCK.format(new Date(iso)).replace(/\s+/g, ' ').toLowerCase();
}

/** The window of a session that cannot be marked now: "closed at 2:00 pm" or "opens at 2:00 pm". */
export function windowNote(card: SessionCard): string | undefined {
  const w = card.scheduled.window;
  if (!w) return undefined;
  if (card.status === 'closed') return `closed at ${spokenTime(card.address.date, w.end)}`;
  if (card.status === 'future') return `opens at ${spokenTime(card.address.date, w.start)}`;
  return undefined;
}

/** A student as tool results and texts name them (MVP-04 §2.8 `current`). */
export interface StudentView {
  readonly id: string;
  readonly roll: number;
  readonly name: string;
  readonly father_name: string;
  /** The name to call: plus ", father <name>" only when the name repeats in the batch. */
  readonly call_as: string;
}

export function studentView(s: Student, all: readonly Student[]): StudentView {
  const name = nameText(s.name);
  const father = nameText(s.fatherName);
  const repeats = all.filter((x) => x.name === s.name).length > 1;
  return { id: s.id, roll: s.rollNo, name, father_name: father, call_as: repeats ? `${name}, father ${father}` : name };
}

/** Counts by model status: every status in the set (0 included), OJT only when someone is on it, UNMARKED always. */
export function countsOf(draft: DraftSnapshot, statuses: readonly StatusCode[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(statuses.filter((c) => c !== 'ojt').map((c) => [toModelStatus(c), 0]));
  let unmarked = 0;
  for (const st of draft.students) {
    const status = draft.marks[st.id]?.status;
    if (status) counts[toModelStatus(status)] = (counts[toModelStatus(status)] ?? 0) + 1;
    else unmarked += 1;
  }
  counts.UNMARKED = unmarked;
  return counts;
}

const DAY = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });

/** "Wednesday, 7 October": how the agent says the last day of a leave (MVP `dayWords`). */
export const dayWords = (date: LocalDate): string => DAY.format(instantAt(date, '12:00'));

/** A status with its detail, as the agent says it: "half day, first half", "leave, sick, until Wednesday, 7 October". */
export function statusWords(mark: Mark): string {
  if (!mark.status) return 'unmarked';
  const half = mark.half ? `, ${mark.half === 1 ? 'first' : 'second'} half` : '';
  const leave = mark.leaveType ? `, ${word(mark.leaveType)}` : '';
  const until = mark.leaveUntil ? `, until ${dayWords(mark.leaveUntil)}` : '';
  return `${word(mark.status)}${half}${leave}${until}`;
}

/** PRD §8.2: "830 metres" under 1 km, "24.36 kilometres" (two decimals) from 1 km. */
export function distanceText(distanceM: number): string {
  const { value, unit } = distanceParts(distanceM);
  return unit === 'km' ? `${value.toFixed(2)} kilometres` : `${value} ${value === 1 ? 'metre' : 'metres'}`;
}

/**
 * The checks the screen runs, as the agent names them: "location and face", "location" or "face" ("" with none). Silent
 * geo-tagging ('background') is never named: it has no voice line (PRD 8.1), as in verificationPhrase.
 */
export function checkWords(v: { readonly location: string; readonly face: boolean }): CheckWords | '' {
  const location = v.location === 'fence';
  if (location && v.face) return 'location and face';
  if (location) return 'location';
  return v.face ? 'face' : '';
}

/** The checks a voice line names: what checkWords and verificationPhrase return when a check is named. */
export type CheckWords = 'location and face' | 'location' | 'face';

const CHECK_LINES: Readonly<Record<CheckWords, string>> = {
  'location and face': 'Checking your location, then please look at the camera.',
  location: 'Checking your location.',
  face: 'Please look at the camera.',
};

/** The agent's one line as a check starts (D-148): it names the steps and the camera, never "the screen" (the card's pause). */
export const checkLine = (words: CheckWords): string => CHECK_LINES[words];

/** What the gateway checks, for the voice line. null when only silent geo-tagging runs (PRD 8.1: no voice line for tagging). */
export function verificationPhrase(plan: FlowPlan): CheckWords | null {
  const location = plan.verification.location === 'fence';
  const face = plan.verification.face;
  if (location && face) return 'location and face';
  if (location) return 'location';
  return face ? 'face' : null;
}
