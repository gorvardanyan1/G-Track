import { describe, expect, it } from 'vitest';
import { donutSegment, hoursAxisMax, niceMax, segmentAngles } from '../src/lib/charts.ts';

describe('chart math', () => {
  it('nice axis maxima', () => {
    expect([0, 0.7, 3, 7.2, 12, 260].map(niceMax)).toEqual([1, 1, 5, 10, 20, 500]);
    expect(hoursAxisMax(0)).toBe(3600);
    expect(hoursAxisMax(7.2 * 3600)).toBe(10 * 3600);
  });

  it('segments share the full circle', () => {
    const angles = segmentAngles([1, 1, 2]);
    expect(angles.map((a) => (a.to - a.from) / (Math.PI * 2))).toEqual([0.25, 0.25, 0.5]);
    expect(segmentAngles([0, 0])).toEqual([]);
    expect(donutSegment(80, 80, 76, 52, 0, Math.PI * 2)).toMatch(/^M80\.000 4\.000A76 76 0 1 1 /);
  });
});
