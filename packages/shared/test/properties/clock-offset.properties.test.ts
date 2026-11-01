import { describe, expect, it } from 'vitest';
import { createClockOffsetEstimator, elapsedSeconds } from '../../src/index.ts';
import { createRandom } from './random.ts';

describe('clock offset estimator (properties)', () => {
  it('finds the true offset despite jitter, asymmetric delays and a few outliers', () => {
    const random = createRandom();
    for (let run = 0; run < 200; run += 1) {
      const trueOffset = random.int(-6 * 3_600_000, 6 * 3_600_000);
      const estimator = createClockOffsetEstimator();
      let clientNow = 1_793_000_000_000;
      for (let i = 0; i < 15; i += 1) {
        const outlier = random.bool(0.2);
        const up = random.int(5, outlier ? 4000 : 120);
        const down = random.int(5, outlier ? 4000 : 120);
        const requestStart = clientNow;
        const serverTime = requestStart + up + trueOffset;
        const responseEnd = requestStart + up + down;
        estimator.addSample({ requestStart, responseEnd, serverTime });
        clientNow = responseEnd + random.int(100, 5000);
      }
      // Ordinary samples are off by at most half their round-trip asymmetry (< 60 ms).
      expect(Math.abs(estimator.offsetMs - trueOffset)).toBeLessThan(250);
    }
  });

  it('elapsed time is whole seconds, never negative, and grows with server time', () => {
    const random = createRandom();
    for (let i = 0; i < 1000; i += 1) {
      const startedAt = 1_793_000_000_000 + random.int(-1e7, 1e7);
      const client = startedAt + random.int(-5000, 3e8);
      const offset = random.int(-1e6, 1e6);
      const e = elapsedSeconds(startedAt, client, offset);
      expect(Number.isInteger(e) && e >= 0).toBe(true);
      expect(elapsedSeconds(startedAt, client + 1000, offset)).toBeGreaterThanOrEqual(e);
    }
  });
});
