// Estimates how far the device clock is from the server clock, using the X-Server-Time header.
// All inputs are epoch milliseconds: requestStart/responseEnd from the client's Date.now(),
// serverTime from the header. offset = server − client, so serverNow ≈ clientNow + offset.

export interface ClockSample {
  requestStart: number;
  responseEnd: number;
  serverTime: number;
}

export interface ClockMeasurement {
  offsetMs: number;
  roundTripMs: number;
}

/** Assumes the server stamped its time halfway through the round trip. */
export function measureClockOffset(sample: ClockSample): ClockMeasurement {
  const { requestStart, responseEnd, serverTime } = sample;
  if (![requestStart, responseEnd, serverTime].every(Number.isFinite)) {
    throw new RangeError('Clock sample values must be finite numbers');
  }
  if (responseEnd < requestStart)
    throw new RangeError('responseEnd must not be before requestStart');
  return {
    offsetMs: serverTime - (requestStart + responseEnd) / 2,
    roundTripMs: responseEnd - requestStart,
  };
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('median of an empty list');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as number;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] as number) + upper) / 2;
}

/** Parses the X-Server-Time header; null if missing or malformed. */
export function parseServerTimeHeader(value: string | null | undefined): number | null {
  if (!value || !/^\d{1,16}$/.test(value)) return null;
  return Number(value);
}

export interface ClockOffsetEstimatorOptions {
  /** How many recent samples the median is taken over. */
  maxSamples?: number;
  /** Samples with a slower round trip are too imprecise and are ignored. */
  maxRoundTripMs?: number;
}

export interface ClockOffsetEstimator {
  /** Returns false if the sample was rejected (invalid or too slow). */
  addSample(sample: ClockSample): boolean;
  /** Median offset of recent samples; 0 until the first sample arrives. */
  readonly offsetMs: number;
  readonly sampleCount: number;
  reset(): void;
}

/** Smooths offsets with a median, so a single slow or odd response can't move the timer. */
export function createClockOffsetEstimator(
  options: ClockOffsetEstimatorOptions = {},
): ClockOffsetEstimator {
  const maxSamples = options.maxSamples ?? 15;
  const maxRoundTripMs = options.maxRoundTripMs ?? 10_000;
  if (!Number.isInteger(maxSamples) || maxSamples < 1)
    throw new RangeError('maxSamples must be ≥ 1');

  let offsets: number[] = [];
  let current = 0;

  return {
    addSample(sample) {
      let measurement: ClockMeasurement;
      try {
        measurement = measureClockOffset(sample);
      } catch {
        return false;
      }
      if (measurement.roundTripMs > maxRoundTripMs) return false;
      offsets.push(measurement.offsetMs);
      if (offsets.length > maxSamples) offsets = offsets.slice(-maxSamples);
      current = median(offsets);
      return true;
    },
    get offsetMs() {
      return current;
    },
    get sampleCount() {
      return offsets.length;
    },
    reset() {
      offsets = [];
      current = 0;
    },
  };
}

/** The server's current time as seen from this device. */
export function serverNow(clientNowMs: number, offsetMs: number): number {
  return clientNowMs + offsetMs;
}

/** Whole seconds a running timer has been going, using server time; never negative. */
export function elapsedSeconds(
  startedAt: Date | number,
  clientNowMs: number,
  offsetMs: number,
): number {
  const startMs = typeof startedAt === 'number' ? startedAt : startedAt.getTime();
  return Math.max(0, Math.floor((serverNow(clientNowMs, offsetMs) - startMs) / 1000));
}

/** Device clocks off by more than this get a (non-blocking) warning in the UI. */
export const CLOCK_SKEW_WARNING_MS = 2 * 60_000;

export function isClockSkewed(offsetMs: number, thresholdMs = CLOCK_SKEW_WARNING_MS): boolean {
  return Math.abs(offsetMs) > thresholdMs;
}
