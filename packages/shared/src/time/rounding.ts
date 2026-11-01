export const RoundingMode = {
  NEAREST: 'NEAREST',
  UP: 'UP',
  DOWN: 'DOWN',
} as const;

export type RoundingMode = (typeof RoundingMode)[keyof typeof RoundingMode];

export interface RoundingRule {
  /** Step in minutes; 0 disables rounding. */
  minutes: number;
  mode: RoundingMode;
}

/**
 * Rounds a duration to a multiple of `rule.minutes`. For reports and exports only; stored
 * durations are never rounded. NEAREST rounds exact halves up (7:30 → 15:00 with a 15 min step).
 */
export function roundDuration(seconds: number, rule: RoundingRule): number {
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new RangeError(`Duration must be a non-negative whole number of seconds: ${seconds}`);
  }
  if (!Number.isInteger(rule.minutes) || rule.minutes < 0) {
    throw new RangeError(
      `Rounding step must be a non-negative whole number of minutes: ${rule.minutes}`,
    );
  }
  if (rule.minutes === 0) return seconds;

  const step = rule.minutes * 60;
  const remainder = seconds % step;
  if (remainder === 0) return seconds;
  const down = seconds - remainder;
  switch (rule.mode) {
    case 'DOWN':
      return down;
    case 'UP':
      return down + step;
    case 'NEAREST':
      return remainder * 2 >= step ? down + step : down;
  }
}

/**
 * Rounds each entry, then sums — the usual billing convention, and what a report showing
 * per-entry rounded values must total to. Rounding the sum instead is just `roundDuration(sum)`.
 */
export function sumRounded(durations: readonly number[], rule: RoundingRule): number {
  return durations.reduce((total, seconds) => total + roundDuration(seconds, rule), 0);
}
