/**
 * The per-session context every service call receives: who is signed in,
 * where, under which resolved configuration, and what they can reach. Built
 * once at session start (PRD §5.2) by the SessionService.
 */
import type { AppConfiguration } from '@/config/types';
import type { Journey } from '@/config/journey';
import type { AccessScope } from '@/domain/access';
import type { Institute, MasterData, StaffMember } from '@/domain/entities';
import type { Clock } from '@/lib/time';

export interface SessionContext {
  readonly user: StaffMember;
  readonly institute: Institute;
  readonly config: AppConfiguration;
  readonly access: AccessScope;
  readonly journey: Journey;
  /** The institute's master data snapshot for this session. */
  readonly data: MasterData;
  readonly clock: Clock;
  /**
   * The real time of day, for greetings only (D-151). Demo builds pass the device clock while `clock` stays the demo
   * clock; production and tests pass the same clock as `clock`. Windows, cards and rules never read it.
   */
  readonly wallClock: Clock;
}
