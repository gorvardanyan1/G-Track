import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { UnauthorizedError } from '../errors/app-error.ts';
import type { Clock } from './clock.ts';

// HS256 only. The header is fixed and compared byte-for-byte, so "alg: none" or algorithm
// confusion can't happen.
const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const ISSUER = 'tempo';
const CLOCK_SKEW_SECONDS = 30;

/** access = API calls; mfa = second login step; mfa_setup = forced 2FA enrolment. */
export type TokenType = 'access' | 'mfa' | 'mfa_setup';

const claimsSchema = z.object({
  iss: z.literal(ISSUER),
  sub: z.uuid(),
  typ: z.enum(['access', 'mfa', 'mfa_setup']),
  sid: z.uuid().optional(),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type TokenClaims = z.infer<typeof claimsSchema>;

export interface JwtService {
  sign(
    claims: { sub: string; typ: TokenType; sid?: string },
    ttlSeconds: number,
  ): { token: string; expiresAt: Date };
  /** Throws UnauthorizedError (INVALID_TOKEN) for anything but a valid, unexpired token of `type`. */
  verify(token: string, type: TokenType): TokenClaims;
}

export function createJwtService(secret: string, clock: Clock): JwtService {
  const signature = (input: string) => createHmac('sha256', secret).update(input).digest();
  const invalid = () => new UnauthorizedError('Invalid or expired token', 'INVALID_TOKEN');

  return {
    sign(claims, ttlSeconds) {
      const iat = Math.floor(clock().getTime() / 1000);
      const exp = iat + ttlSeconds;
      const payload = Buffer.from(JSON.stringify({ iss: ISSUER, ...claims, iat, exp })).toString(
        'base64url',
      );
      const unsigned = `${HEADER}.${payload}`;
      return {
        token: `${unsigned}.${signature(unsigned).toString('base64url')}`,
        expiresAt: new Date(exp * 1000),
      };
    },

    verify(token, type) {
      const parts = token.split('.');
      if (parts.length !== 3) throw invalid();
      const [header, payload, sig] = parts as [string, string, string];
      if (header !== HEADER) throw invalid();

      const expected = signature(`${header}.${payload}`);
      const actual = Buffer.from(sig, 'base64url');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw invalid();

      let claims: TokenClaims;
      try {
        claims = claimsSchema.parse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')));
      } catch {
        throw invalid();
      }
      const now = Math.floor(clock().getTime() / 1000);
      if (claims.typ !== type || claims.exp <= now || claims.iat > now + CLOCK_SKEW_SECONDS) {
        throw invalid();
      }
      return claims;
    },
  };
}
