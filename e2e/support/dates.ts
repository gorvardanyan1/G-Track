/** The local calendar date ("YYYY-MM-DD") `days` from today in an IANA timezone. */
export function localDate(zone: string, days = 0): string {
  const at = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone }).format(at);
}
