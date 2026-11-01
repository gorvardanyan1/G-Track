const MINUTE = 60;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * MINUTE;
/** Second login step (TOTP / recovery code) must happen within this time. */
export const TWO_FACTOR_CHALLENGE_TTL_SECONDS = 5 * MINUTE;
/** Super Admins without 2FA get this long to enrol during login. */
export const TWO_FACTOR_SETUP_TTL_SECONDS = 15 * MINUTE;
export const INVITE_TTL_MS = 48 * 60 * MINUTE * 1000;
export const PASSWORD_RESET_TTL_MS = 30 * MINUTE * 1000;
/**
 * A rotated refresh token presented again within this window gets 409 instead of revoking the
 * session: two tabs refreshing at the same moment is normal, not an attack.
 */
export const REFRESH_REUSE_GRACE_MS = 10_000;
export const TOTP_ISSUER = 'TEMPO';
