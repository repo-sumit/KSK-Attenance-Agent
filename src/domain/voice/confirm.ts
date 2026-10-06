/**
 * Confirmation tokens for Voice Agent (D-082). Submitting a roll and marking everyone who is left are the
 * two voice actions that change a lot at once, and the principal's mark for a staff member, or for every staff member
 * not marked yet, is final for the day (D-141, D-156), so the model cannot do any of them in the breath it asks. The
 * executor issues a short code with the question, and the model can only act by echoing that code. A code
 * is good for one answer:
 *  - it belongs to one action and its arguments (`argsKey`, for example `${sessionKey}|PRESENT`);
 *  - it belongs to one draft revision (for a staff mark, today's staff records), so a change in between voids it;
 *  - it belongs to one Live connection (`generation`), so a swapped or dropped connection voids it;
 *  - it lasts CONFIRM_TTL_MS;
 *  - it is accepted only after the trainer has spoken AFTER the question: the model turn it was issued in has
 *    ended (`turnSeq` has gone up) and a new trainer turn began after that (`spokeAtTurn`, the model-turn count
 *    when the trainer's latest turn began, is past the ticket's `turnSeq`; `speechSeq` has gone up). Late
 *    transcript fragments of the words that led to the question never count, so the model cannot ask and
 *    confirm in one breath.
 * The caller keeps at most one ticket, drops it after `ok`, and answers any refusal with a fresh question.
 * Pure TypeScript: no clock, no randomness. The caller passes `now` and the entropy (`crypto` in the
 * app, a fixed list in tests).
 */

export type ConfirmAction = 'submit_attendance' | 'mark_remaining' | 'mark_staff' | 'mark_remaining_staff';

/** How long a token stays valid after it is issued: 2 minutes. */
export const CONFIRM_TTL_MS = 120_000;

/** Upper case letters and the digits 2 to 9, without the look-alikes 0 O 1 I. Its 32 characters let a number in [0, 1) pick one evenly. */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TOKEN_LENGTH = 4;

export interface ConfirmTicket {
  /** 4 characters of ALPHABET. */
  readonly token: string;
  readonly action: ConfirmAction;
  /** What the action applies to, for example `${sessionKey}|PRESENT`. */
  readonly argsKey: string;
  /** Draft revision when issued. */
  readonly revision: number;
  /** Clock time when issued, in ms. */
  readonly issuedAt: number;
  /** Trainer turns seen when issued. */
  readonly speechSeq: number;
  /** Ended model turns (turnComplete or interrupted) seen when issued. */
  readonly turnSeq: number;
  /** Live connection generation when issued. */
  readonly generation: number;
}

/** The world at one moment: what is being confirmed, and the clock and counters a ticket is compared with. */
export interface ConfirmNow {
  readonly action: ConfirmAction;
  readonly argsKey: string;
  readonly revision: number;
  readonly now: number;
  /** Trainer turns so far: one per turn, counted at its first words after a model turn ended. */
  readonly speechSeq: number;
  /** Ended model turns so far. */
  readonly turnSeq: number;
  /** `turnSeq` when the trainer's latest turn began (0 before any). */
  readonly spokeAtTurn: number;
  readonly generation: number;
}

export type ConfirmCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'missing' | 'unknown' | 'expired' | 'changed' | 'not_heard' | 'stale_connection' };

/** One character of ALPHABET for a number in [0, 1) (the caller has checked the range; the index wraps as a last resort). */
function pick(entropy: number): string {
  const size = ALPHABET.length;
  const index = Math.floor(entropy * size);
  return ALPHABET.charAt(((index % size) + size) % size);
}

/**
 * A ticket for `input.action` as the world stands in `input`. `entropy` is numbers in [0, 1) supplied by
 * the caller (domain code generates no randomness itself); the first four make the token, and fewer than
 * four is a caller bug, so it throws rather than issue a short code. A used value that is not a finite number
 * in [0, 1) also throws (a dead entropy source would otherwise give the same code every time).
 */
export function issueConfirm(input: ConfirmNow, entropy: readonly number[]): ConfirmTicket {
  if (entropy.length < TOKEN_LENGTH) throw new RangeError(`issueConfirm needs ${TOKEN_LENGTH} entropy values, got ${entropy.length}`);
  for (const value of entropy.slice(0, TOKEN_LENGTH)) {
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('issueConfirm needs entropy values that are finite numbers in [0, 1)');
  }
  return {
    token: entropy.slice(0, TOKEN_LENGTH).map((value) => pick(value)).join(''),
    action: input.action,
    argsKey: input.argsKey,
    revision: input.revision,
    issuedAt: input.now,
    speechSeq: input.speechSeq,
    turnSeq: input.turnSeq,
    generation: input.generation,
  };
}

/**
 * May `token`, as the model passed it, confirm `now.action`? `token` is read loosely, like the other values
 * the model passes: surrounding spaces and letter case do not matter, and nothing is coerced (a number or a
 * list is never the token). Absent, null and blank all count as "no token", so the caller can ask the
 * question instead of reporting a wrong code. The first failing check names the reason, in this order:
 * missing, unknown (no ticket, another code, another action), stale_connection, expired, changed (the
 * draft revision or the arguments moved on), not_heard (no trainer turn began after the asking model turn
 * ended). The time and speech checks state what is accepted, not what is refused, so they fail closed: a
 * clock that is not finite or is earlier than the ticket's is refused (`expired`), and so is a turn or speech
 * count that is not finite (`not_heard`).
 */
export function checkConfirm(ticket: ConfirmTicket | null, token: unknown, now: ConfirmNow): ConfirmCheck {
  const echoed = typeof token === 'string' ? token.trim().toUpperCase() : token;
  if (echoed === undefined || echoed === null || echoed === '') return { ok: false, reason: 'missing' };
  if (!ticket || echoed !== ticket.token.toUpperCase() || ticket.action !== now.action) return { ok: false, reason: 'unknown' };
  if (ticket.generation !== now.generation) return { ok: false, reason: 'stale_connection' };
  // Acceptance is written positively: every comparison with NaN is false, so "refuse when too old" would let NaN through.
  // A clock that is not a finite number (NaN, Infinity) is refused like a backwards one.
  const age = now.now - ticket.issuedAt;
  if (!Number.isFinite(now.now) || !(age >= 0 && age <= CONFIRM_TTL_MS)) return { ok: false, reason: 'expired' };
  if (ticket.revision !== now.revision || ticket.argsKey !== now.argsKey) return { ok: false, reason: 'changed' };
  // Infinity would pass `>`, so a count that is not finite is refused outright. Heard: the asking turn ended,
  // and the trainer's latest turn began after that (not a late fragment of the words that led to the question).
  const counts = [now.speechSeq, now.turnSeq, now.spokeAtTurn];
  const heard = counts.every(Number.isFinite) && now.turnSeq > ticket.turnSeq && now.speechSeq > ticket.speechSeq && now.spokeAtTurn > ticket.turnSeq;
  if (!heard) return { ok: false, reason: 'not_heard' };
  return { ok: true };
}
