import { describe, expect, it } from 'vitest';
import { buildSeed } from '@/data/mock/seeds';
import { STAFF } from '@/data/mock/staff';

const TODAY = '2026-09-25';

/**
 * The default story obeys own attendance first (D-152, U2): every batch submitted today was submitted by someone who
 * had marked their own attendance earlier today. Rajesh, Sanjay, Pradeep and Asha are still unmarked, so they submit
 * nothing; colleagues of the same trade submitted their batches.
 */
describe('the seed and own attendance first', () => {
  const seed = buildSeed(TODAY);
  const selfAt = new Map(seed.staffRecords.filter((r) => r.date === TODAY && r.source === 'self').map((r) => [r.staffId, r.deviceTimestamp]));

  it('every submission today is by a staff member who self-marked before submitting', () => {
    expect(seed.submissions.length).toBeGreaterThan(0);
    for (const s of seed.submissions) {
      const marked = selfAt.get(s.markedBy);
      expect(marked, `${s.sessionKey} by ${s.markedBy}`).toBeDefined();
      expect(marked! < s.deviceTimestamp, `${s.sessionKey}: self ${marked} before ${s.deviceTimestamp}`).toBe(true);
    }
  });

  it('each submitter teaches the batch\'s trade', () => {
    for (const s of seed.submissions) {
      const tradeId = s.address.batchId.split('-')[0];
      expect(STAFF.find((m) => m.id === s.markedBy)?.primaryTradeId, s.sessionKey).toBe(tradeId);
    }
  });

  it('the unmarked instructors stay unmarked and submit nothing', () => {
    for (const id of ['st-rajesh', 'st-sanjay', 'st-pradeep', 'st-asha']) {
      expect(selfAt.has(id), id).toBe(false);
      expect(seed.submissions.some((s) => s.markedBy === id), id).toBe(false);
    }
  });
});
