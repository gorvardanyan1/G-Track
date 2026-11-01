import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateTotp,
  generateTotpSecret,
  hotp,
  otpauthUrl,
  totpStep,
  verifyTotp,
} from '../../src/lib/totp.ts';

// RFC 6238 Appendix B (SHA-1), secret = ASCII "12345678901234567890", 8 digits.
const RFC_SECRET = Buffer.from('12345678901234567890');
const RFC_VECTORS: [number, string][] = [
  [59, '94287082'],
  [1_111_111_109, '07081804'],
  [1_111_111_111, '14050471'],
  [1_234_567_890, '89005924'],
  [2_000_000_000, '69279037'],
  [20_000_000_000, '65353130'],
];

describe('TOTP', () => {
  it.each(RFC_VECTORS)('matches RFC 6238 at T=%i', (seconds, expected) => {
    expect(hotp(RFC_SECRET, totpStep(new Date(seconds * 1000)), 8)).toBe(expected);
  });

  it('matches RFC 4226 HOTP vectors (6 digits)', () => {
    const expected = [
      '755224',
      '287082',
      '359152',
      '969429',
      '338314',
      '254676',
      '287922',
      '162583',
      '399871',
      '520489',
    ];
    expect(expected.map((_, counter) => hotp(RFC_SECRET, counter))).toEqual(expected);
  });

  it('round-trips base32 (RFC 4648 vectors)', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb-oi==').toString()).toBe('foobar');
    expect(() => base32Decode('MZXW1')).toThrow(RangeError);
  });

  it('generates 160-bit secrets', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
  });

  describe('verifyTotp', () => {
    const secret = base32Encode(RFC_SECRET);
    const now = new Date('2026-10-31T10:00:15Z');

    it('accepts the current code and returns its step', () => {
      expect(verifyTotp(secret, generateTotp(secret, now), now)).toBe(totpStep(now));
    });

    it('tolerates one step of drift either way, but not two', () => {
      const prev = new Date(now.getTime() - 30_000);
      const next = new Date(now.getTime() + 30_000);
      const twoAgo = new Date(now.getTime() - 60_000);
      expect(verifyTotp(secret, generateTotp(secret, prev), now)).toBe(totpStep(prev));
      expect(verifyTotp(secret, generateTotp(secret, next), now)).toBe(totpStep(next));
      expect(verifyTotp(secret, generateTotp(secret, twoAgo), now)).toBeNull();
    });

    it.each(['', '12345', '1234567', 'abcdef', '12 456'])('rejects malformed code %j', (code) => {
      expect(verifyTotp(secret, code, now)).toBeNull();
    });
  });

  it('builds an otpauth URL authenticator apps understand', () => {
    const raw = otpauthUrl({
      secret: 'JBSWY3DPEHPK3PXP',
      accountName: 'lena@tempo.test',
      issuer: 'TEMPO',
    });
    expect(raw.startsWith('otpauth://totp/TEMPO:lena%40tempo.test?')).toBe(true);
    const url = new URL(raw);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      issuer: 'TEMPO',
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
  });
});
