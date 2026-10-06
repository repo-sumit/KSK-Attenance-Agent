import { describe, expect, it } from 'vitest';
import { greetingKey } from '@/features/common/labels';
import { FixedClock, dayPart, instantAt } from '@/lib/time';
import { MemoryStore } from '@/lib/kv-store';
import { createMockContainer } from '@/services/container';
import { DEFAULT_SIMULATION, StaticSimulationSource } from '@/services/simulation';
import { TODAY } from '../../helpers/fixtures';
import { setup, signIn } from '../../helpers/app';

const at = (time: string) => instantAt(TODAY, time);

// Greetings follow the real time of day (D-151): four IST day parts.
const BOUNDARIES: readonly (readonly [string, 'morning' | 'afternoon' | 'evening' | 'night'])[] = [
  ['04:59', 'night'],
  ['05:00', 'morning'],
  ['11:59', 'morning'],
  ['12:00', 'afternoon'],
  ['16:59', 'afternoon'],
  ['17:00', 'evening'],
  ['20:59', 'evening'],
  ['21:00', 'night'],
  ['23:59', 'night'],
  ['00:00', 'night'],
];

describe('dayPart (IST)', () => {
  it.each(BOUNDARIES)('%s is %s', (time, part) => {
    expect(dayPart(at(time))).toBe(part);
  });

  it('reads IST, whatever the device time zone: 18:30 UTC is midnight in India', () => {
    expect(dayPart(new Date('2026-09-25T18:30:00Z'))).toBe('night');
    expect(dayPart(new Date('2026-09-25T06:30:00Z'))).toBe('afternoon');
  });
});

describe('greetingKey', () => {
  it.each(BOUNDARIES)('%s greets with greeting.%s', (time, part) => {
    expect(greetingKey(at(time))).toBe(`greeting.${part}`);
  });
});

describe('ctx.wallClock: the real time of day, for greetings only', () => {
  it('the session carries the container’s wall clock beside its app clock', async () => {
    const wallClock = new FixedClock(at('14:30'));
    const { app, clock } = setup({}, { wallClock });
    const ctx = await signIn(app, 'TR-10432');
    expect(ctx.wallClock).toBe(wallClock);
    expect(ctx.clock).toBe(clock);
  });

  it('without a separate wall clock (production) it is the same clock as ctx.clock', async () => {
    const clock = new FixedClock(at('10:15'));
    const app = createMockContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock, simulation: new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0 }) });
    app.services.sync.start(); // as setup() does: the first read seeds the day before the session is written
    const ctx = await signIn(app, 'TR-10432');
    expect(ctx.wallClock).toBe(clock);
  });
});
