/**
 * Seconds to add to usage totals fetched at `fetchedAtMs` (server time) so they stay live:
 * the api counted running timers up to the fetch, so each timer adds the time since then —
 * or since its own start, if it started after the fetch.
 */
export function liveExtraSeconds(
  runningSince: readonly string[],
  fetchedAtMs: number,
  nowMs: number,
): number {
  return runningSince.reduce((sum, startedAt) => {
    const from = Math.max(Date.parse(startedAt), fetchedAtMs);
    return sum + Math.max(0, Math.floor((nowMs - from) / 1000));
  }, 0);
}
