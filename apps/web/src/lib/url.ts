/** Reads `#token=…` (invite and reset links keep the token out of server logs and Referer). */
export function tokenFromHash(hash: string): string | null {
  const match = /(?:^#|&)token=([A-Za-z0-9_-]{20,512})(?:&|$)/.exec(hash);
  return match?.[1] ?? null;
}
