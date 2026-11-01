function assertFiniteSeconds(seconds: number): void {
  if (!Number.isFinite(seconds)) throw new RangeError(`Invalid duration: ${seconds}`);
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * "HH:MM:SS" for a duration in seconds. Hours are not wrapped at 24 ("27:03:09"); fractional
 * seconds are truncated so a live timer never shows a second that hasn't fully passed.
 */
export function formatDuration(seconds: number): string {
  assertFiniteSeconds(seconds);
  const total = Math.floor(Math.abs(seconds));
  const sign = seconds < 0 && total > 0 ? '-' : '';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${sign}${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** "H:MM" without seconds, for compact totals (rounds down to the minute). */
export function formatDurationHm(seconds: number): string {
  assertFiniteSeconds(seconds);
  const total = Math.floor(Math.abs(seconds) / 60);
  const sign = seconds < 0 && total > 0 ? '-' : '';
  return `${sign}${Math.floor(total / 60)}:${pad(total % 60)}`;
}

/**
 * Decimal hours as a string, e.g. 5400 s → "1.50". Rounds half away from zero using integer
 * math, so values like 1.005 h don't fall victim to binary floating-point rounding.
 */
export function formatDecimalHours(seconds: number, decimals = 2): string {
  assertFiniteSeconds(seconds);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    throw new RangeError(`Invalid number of decimals: ${decimals}`);
  }
  const factor = 10 ** decimals;
  const scaled = Math.round((Math.abs(seconds) * factor) / 3600);
  const sign = seconds < 0 && scaled > 0 ? '-' : '';
  return `${sign}${(scaled / factor).toFixed(decimals)}`;
}

/** Decimal hours as a number (e.g. for CSV exports or charts). */
export function toDecimalHours(seconds: number, decimals = 2): number {
  return Number(formatDecimalHours(seconds, decimals));
}
