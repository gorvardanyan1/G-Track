/** The local calendar date ("YYYY-MM-DD") `days` from today in an IANA timezone. */
export function localDate(zone: string, days = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

/** Adds days to a calendar date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The Monday on or before a date (the seeded organization's weeks start on Monday). */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
  return addDays(date, 1 - weekday);
}
