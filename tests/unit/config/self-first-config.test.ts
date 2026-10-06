import { describe, expect, it } from 'vitest';
import { PRODUCT_DEFAULTS } from '@/config/defaults';
import { deriveJourney } from '@/config/journey';
import { MAHARASHTRA } from '@/config/states/maharashtra';
import { validateConfiguration } from '@/config/validate';
import type { ConfigLayer } from '@/config/types';
import { resolveAccess } from '@/domain/access';
import { TODAY, configWith, data, staff } from '../../helpers/fixtures';

const ctx = { data, enrolledFaceCount: 10 };
const codes = (layer: ConfigLayer) => validateConfiguration(configWith(layer), ctx).map((i) => i.code);

describe('own attendance first: configuration (D-152)', () => {
  it('is off in the product defaults and on in Maharashtra, with a 10-minute self pass reuse there', () => {
    expect(PRODUCT_DEFAULTS.staff.selfBeforeStudents).toBe(false);
    expect(PRODUCT_DEFAULTS.verification.selfPassReuseMinutes).toBe(0);
    expect(MAHARASHTRA.base.staff.selfBeforeStudents).toBe(true);
    expect(MAHARASHTRA.base.verification.selfPassReuseMinutes).toBe(10);
    expect(codes({})).not.toContain('self_before_students_needs_self_marking');
  });
  it('needs staff attendance with self-marking', () => {
    expect(codes({ staff: { enabled: false } })).toContain('self_before_students_needs_self_marking');
    expect(codes({ staff: { selfMarking: false } })).toContain('self_before_students_needs_self_marking');
    expect(codes({ staff: { enabled: false, selfBeforeStudents: false } })).not.toContain('self_before_students_needs_self_marking');
  });
  it('the reuse window is 0 to 60 whole minutes', () => {
    for (const ok of [0, 10, 60]) expect(codes({ verification: { selfPassReuseMinutes: ok } })).not.toContain('self_pass_reuse_minutes');
    for (const bad of [-1, 61, 2.5]) expect(codes({ verification: { selfPassReuseMinutes: bad } })).toContain('self_pass_reuse_minutes');
  });
});

describe('own attendance first: journey (D-152)', () => {
  const journeyFor = (id: string, overrides: ConfigLayer = {}) => {
    const cfg = configWith(overrides);
    return deriveJourney(cfg, staff(id), resolveAccess(staff(id), cfg, data, TODAY), true);
  };
  it('an instructor who marks their own attendance gets the step', () => {
    expect(journeyFor('st-rajesh').staff.selfFirst).toBe(true);
    expect(journeyFor('st-sunita', { mapping: { model: 'batch' } }).staff.selfFirst).toBe(true);
  });
  it('the principal never has it (no self attendance)', () => {
    expect(journeyFor('st-anil').staff.selfFirst).toBe(false);
  });
  it('absent when the rule, staff attendance or self-marking is off', () => {
    expect(journeyFor('st-rajesh', { staff: { selfBeforeStudents: false } }).staff.selfFirst).toBe(false);
    expect(journeyFor('st-rajesh', { staff: { enabled: false } }).staff.selfFirst).toBe(false);
    expect(journeyFor('st-rajesh', { staff: { selfMarking: false } }).staff.selfFirst).toBe(false);
  });
});
