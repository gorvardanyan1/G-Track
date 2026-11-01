import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../../src/errors/app-error.ts';
import { createJwtService } from '../../src/lib/jwt.ts';

const SECRET = 'jwt-unit-test-secret-at-least-32-chars!';
const SUB = '0190a7c4-5b7e-7cc1-8e5f-2a3b4c5d6e7f';
const SID = '0190a7c4-5b7e-7cc1-8e5f-000000000001';

function at(iso: string) {
  let now = new Date(iso);
  return { clock: () => now, set: (next: string) => (now = new Date(next)) };
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

describe('jwt', () => {
  it('signs and verifies a token of the expected type', () => {
    const time = at('2026-10-31T10:00:00Z');
    const jwt = createJwtService(SECRET, time.clock);
    const { token, expiresAt } = jwt.sign({ sub: SUB, typ: 'access', sid: SID }, 900);
    expect(expiresAt).toEqual(new Date('2026-10-31T10:15:00Z'));
    expect(jwt.verify(token, 'access')).toMatchObject({
      sub: SUB,
      sid: SID,
      typ: 'access',
      iss: 'tempo',
    });
  });

  it('rejects expired tokens', () => {
    const time = at('2026-10-31T10:00:00Z');
    const jwt = createJwtService(SECRET, time.clock);
    const { token } = jwt.sign({ sub: SUB, typ: 'access' }, 900);
    time.set('2026-10-31T10:15:00Z');
    expect(() => jwt.verify(token, 'access')).toThrow(UnauthorizedError);
  });

  it('rejects a token of another type (a 2FA challenge is not an access token)', () => {
    const jwt = createJwtService(SECRET, at('2026-10-31T10:00:00Z').clock);
    const { token } = jwt.sign({ sub: SUB, typ: 'mfa' }, 300);
    expect(() => jwt.verify(token, 'access')).toThrow(UnauthorizedError);
  });

  it('rejects tokens signed with another secret', () => {
    const clock = at('2026-10-31T10:00:00Z').clock;
    const { token } = createJwtService('another-secret-also-32-characters-long', clock).sign(
      { sub: SUB, typ: 'access' },
      900,
    );
    expect(() => createJwtService(SECRET, clock).verify(token, 'access')).toThrow(
      UnauthorizedError,
    );
  });

  it('rejects a tampered payload', () => {
    const jwt = createJwtService(SECRET, at('2026-10-31T10:00:00Z').clock);
    const [header, , sig] = jwt.sign({ sub: SUB, typ: 'mfa' }, 300).token.split('.');
    const forged = b64({ iss: 'tempo', sub: SUB, typ: 'access', iat: 1, exp: 9_999_999_999 });
    expect(() => jwt.verify(`${header}.${forged}.${sig}`, 'access')).toThrow(UnauthorizedError);
  });

  it('rejects alg "none" and other algorithms even with a valid-looking payload', () => {
    const jwt = createJwtService(SECRET, at('2026-10-31T10:00:00Z').clock);
    const payload = b64({
      iss: 'tempo',
      sub: SUB,
      typ: 'access',
      iat: 1_793_000_000,
      exp: 9_999_999_999,
    });
    expect(() => jwt.verify(`${b64({ alg: 'none', typ: 'JWT' })}.${payload}.`, 'access')).toThrow(
      UnauthorizedError,
    );

    // HS512 header signed correctly with the same secret must still be refused.
    const header = b64({ alg: 'HS512', typ: 'JWT' });
    const sig = createHmac('sha512', SECRET).update(`${header}.${payload}`).digest('base64url');
    expect(() => jwt.verify(`${header}.${payload}.${sig}`, 'access')).toThrow(UnauthorizedError);
  });

  it.each(['', 'abc', 'a.b', 'a.b.c.d', '...'])('rejects malformed token %j', (token) => {
    const jwt = createJwtService(SECRET, at('2026-10-31T10:00:00Z').clock);
    expect(() => jwt.verify(token, 'access')).toThrow(UnauthorizedError);
  });

  it('rejects tokens issued in the future beyond clock skew', () => {
    const time = at('2026-10-31T10:05:00Z');
    const { token } = createJwtService(SECRET, time.clock).sign({ sub: SUB, typ: 'access' }, 900);
    time.set('2026-10-31T10:00:00Z');
    expect(() => createJwtService(SECRET, time.clock).verify(token, 'access')).toThrow(
      UnauthorizedError,
    );
  });
});
