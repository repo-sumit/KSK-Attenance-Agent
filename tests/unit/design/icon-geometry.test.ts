import { describe, expect, it } from 'vitest';
import { ICON_PATHS } from '@/components/ui/icons/paths';

/**
 * The Not marked ring (U13): a dashed circle drawn with round caps. Each cap adds half the stroke to both ends of a
 * dash, so a gap shrinks by the whole stroke width. At the widest stroke the app draws it (3, the summary tiles) the
 * gaps must stay open, or the ring reads as a solid "O".
 */
describe('the Not marked icon (circle)', () => {
  const [tag, attrs] = ICON_PATHS.circle[0];
  const r = Number(attrs.r);
  const circumference = 2 * Math.PI * r;
  const unit = circumference / Number(attrs.pathLength ?? circumference);
  const [dash, gap] = attrs.strokeDasharray.split(/\s+/).map(Number);

  it('is one dashed circle', () => {
    expect(tag).toBe('circle');
    expect(dash).toBeGreaterThan(0);
  });

  it('keeps a visible gap (over 1 unit) at stroke 3 and at stroke 2', () => {
    expect(gap * unit - 3).toBeGreaterThan(1);
    expect(gap * unit - 2).toBeGreaterThan(2);
  });

  it('dashes evenly round the ring (whole periods)', () => {
    const periods = circumference / ((dash + gap) * unit);
    expect(Math.abs(periods - Math.round(periods))).toBeLessThan(0.01);
  });
});
