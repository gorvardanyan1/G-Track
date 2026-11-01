import { describe, expect, it } from 'vitest';
import {
  CLOCK_SKEW_WARNING_MS,
  createClockOffsetEstimator,
  elapsedSeconds,
  isClockSkewed,
  measureClockOffset,
  median,
  parseServerTimeHeader,
  serverNow,
} from '../../src/index.ts';

/** A sample from a device whose clock is `skewMs` behind the server, with a symmetric RTT. */
function sample(realStart: number, roundTripMs: number, skewMs: number) {
  return {
    requestStart: realStart - skewMs,
    responseEnd: realStart + roundTripMs - skewMs,
    serverTime: realStart + roundTripMs / 2,
  };
}

describe('measureClockOffset', () => {
  it('uses the midpoint of the round trip', () => {
    expect(measureClockOffset({ requestStart: 1000, responseEnd: 1200, serverTime: 5100 })).toEqual(
      {
        offsetMs: 4000,
        roundTripMs: 200,
      },
    );
  });

  it('is negative when the device clock is ahead', () => {
    expect(
      measureClockOffset({ requestStart: 10_000, responseEnd: 10_100, serverTime: 4050 }).offsetMs,
    ).toBe(-6000);
  });

  it('recovers the real skew for symmetric latency', () => {
    expect(measureClockOffset(sample(1_793_000_000_000, 300, 600_000)).offsetMs).toBe(600_000);
  });

  it('rejects impossible samples', () => {
    expect(() =>
      measureClockOffset({ requestStart: 2000, responseEnd: 1000, serverTime: 1500 }),
    ).toThrow(RangeError);
    expect(() =>
      measureClockOffset({ requestStart: Number.NaN, responseEnd: 1000, serverTime: 1500 }),
    ).toThrow(RangeError);
  });
});

describe('median', () => {
  it('handles odd and even counts without mutating the input', () => {
    const values = [5, 1, 3];
    expect(median(values)).toBe(3);
    expect(values).toEqual([5, 1, 3]);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(median([-3, -1, -2])).toBe(-2);
  });

  it('throws for an empty list', () => {
    expect(() => median([])).toThrow(RangeError);
  });
});

describe('createClockOffsetEstimator', () => {
  const t0 = 1_793_000_000_000;

  it('starts at zero', () => {
    const estimator = createClockOffsetEstimator();
    expect(estimator.offsetMs).toBe(0);
    expect(estimator.sampleCount).toBe(0);
  });

  it('converges on the skew despite asymmetric latency on some samples', () => {
    const estimator = createClockOffsetEstimator();
    for (let i = 0; i < 5; i++) estimator.addSample(sample(t0 + i * 1000, 100 + i * 10, 90_000));
    // One response was delayed on the way back only: its midpoint estimate is off by 1 s.
    estimator.addSample({
      requestStart: t0 + 9000 - 90_000,
      responseEnd: t0 + 11_000 - 90_000,
      serverTime: t0 + 9000,
    });
    expect(estimator.offsetMs).toBe(90_000);
  });

  it('ignores a single wild outlier thanks to the median', () => {
    const estimator = createClockOffsetEstimator();
    for (const skew of [1000, 1010, 990]) estimator.addSample(sample(t0, 100, skew));
    estimator.addSample(sample(t0, 100, 3_600_000));
    expect(estimator.offsetMs).toBe(1005);
  });

  it('only keeps the most recent samples', () => {
    const estimator = createClockOffsetEstimator({ maxSamples: 3 });
    for (const skew of [100, 100, 100, 500, 500, 500]) estimator.addSample(sample(t0, 50, skew));
    expect(estimator.sampleCount).toBe(3);
    expect(estimator.offsetMs).toBe(500);
  });

  it('rejects slow and invalid samples', () => {
    const estimator = createClockOffsetEstimator({ maxRoundTripMs: 2000 });
    expect(estimator.addSample(sample(t0, 5000, 1000))).toBe(false);
    expect(estimator.addSample({ requestStart: 2, responseEnd: 1, serverTime: 1 })).toBe(false);
    expect(estimator.addSample(sample(t0, 200, 1000))).toBe(true);
    expect(estimator.sampleCount).toBe(1);
    expect(estimator.offsetMs).toBe(1000);
  });

  it('can be reset', () => {
    const estimator = createClockOffsetEstimator();
    estimator.addSample(sample(t0, 100, 5000));
    estimator.reset();
    expect(estimator.offsetMs).toBe(0);
    expect(estimator.sampleCount).toBe(0);
  });

  it('validates options', () => {
    expect(() => createClockOffsetEstimator({ maxSamples: 0 })).toThrow(RangeError);
  });
});

describe('live timer helpers', () => {
  const startedAt = new Date('2026-10-31T09:00:00Z');
  const realNow = Date.parse('2026-10-31T10:30:15Z');

  it('shows the correct elapsed time on a device whose clock is 10 minutes slow', () => {
    const offset = 10 * 60_000;
    const deviceNow = realNow - offset;
    expect(serverNow(deviceNow, offset)).toBe(realNow);
    expect(elapsedSeconds(startedAt, deviceNow, offset)).toBe(5415);
  });

  it('shows the correct elapsed time on a device whose clock is 3 hours fast', () => {
    const offset = -3 * 3_600_000;
    expect(elapsedSeconds(startedAt.getTime(), realNow - offset, offset)).toBe(5415);
  });

  it('never goes negative right after start', () => {
    expect(elapsedSeconds(startedAt, startedAt.getTime() - 400, 0)).toBe(0);
  });

  it('floors to whole seconds', () => {
    expect(elapsedSeconds(startedAt, startedAt.getTime() + 1999, 0)).toBe(1);
  });
});

describe('isClockSkewed', () => {
  it('warns only beyond two minutes in either direction', () => {
    expect(CLOCK_SKEW_WARNING_MS).toBe(120_000);
    expect(isClockSkewed(120_000)).toBe(false);
    expect(isClockSkewed(-120_000)).toBe(false);
    expect(isClockSkewed(120_001)).toBe(true);
    expect(isClockSkewed(-180_000)).toBe(true);
    expect(isClockSkewed(5000, 1000)).toBe(true);
  });
});

describe('parseServerTimeHeader', () => {
  it('parses epoch milliseconds', () => {
    expect(parseServerTimeHeader('1793473191280')).toBe(1_793_473_191_280);
  });

  it.each([null, undefined, '', 'abc', '-5', '1.5', '17934731912801234567'])(
    'returns null for %j',
    (value) => {
      expect(parseServerTimeHeader(value)).toBeNull();
    },
  );
});
