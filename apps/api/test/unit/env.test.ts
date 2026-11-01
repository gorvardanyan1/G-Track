import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../../src/config/env.ts';

const valid = {
  DATABASE_URL: 'postgresql://tempo:tempo@localhost:5433/tempo',
  CORS_ORIGINS: 'http://localhost:5173',
  JWT_SECRET: 'x'.repeat(32),
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
};

describe('parseEnv', () => {
  it('applies defaults', () => {
    const env = parseEnv(valid);
    expect(env).toMatchObject({
      REFRESH_TOKEN_TTL_DAYS: 14,
      WEB_APP_URL: 'http://localhost:5173',
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      BODY_LIMIT: '100kb',
      TRUST_PROXY: 0,
    });
  });

  it('coerces numbers and splits the origin list', () => {
    const env = parseEnv({
      ...valid,
      PORT: '8080',
      CORS_ORIGINS: ' http://localhost:5173 , https://app.example.com ,',
    });
    expect(env.PORT).toBe(8080);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://app.example.com']);
  });

  it('returns a frozen object', () => {
    expect(Object.isFrozen(parseEnv(valid))).toBe(true);
  });

  it.each([
    ['missing DATABASE_URL', { ...valid, DATABASE_URL: undefined }, 'DATABASE_URL'],
    ['non-postgres DATABASE_URL', { ...valid, DATABASE_URL: 'mysql://x@y/z' }, 'DATABASE_URL'],
    ['empty CORS_ORIGINS', { ...valid, CORS_ORIGINS: ' , ' }, 'CORS_ORIGINS'],
    ['wildcard CORS origin', { ...valid, CORS_ORIGINS: '*' }, 'CORS_ORIGINS'],
    ['bad PORT', { ...valid, PORT: '70000' }, 'PORT'],
    ['bad BODY_LIMIT', { ...valid, BODY_LIMIT: 'lots' }, 'BODY_LIMIT'],
    ['bad NODE_ENV', { ...valid, NODE_ENV: 'staging' }, 'NODE_ENV'],
    ['short JWT_SECRET', { ...valid, JWT_SECRET: 'short' }, 'JWT_SECRET'],
    [
      '16-byte TOTP key',
      { ...valid, TOTP_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') },
      'TOTP_ENCRYPTION_KEY',
    ],
  ])('rejects %s', (_label, source, variable) => {
    expect(() => parseEnv(source)).toThrow(EnvValidationError);
    expect(() => parseEnv(source)).toThrow(variable);
  });

  it('never echoes variable values in the error message', () => {
    const secretUrl = 'mysql://admin:s3cr3t-pa55@db/prod';
    try {
      parseEnv({ ...valid, DATABASE_URL: secretUrl });
      expect.unreachable();
    } catch (err) {
      expect(String(err)).not.toContain('s3cr3t-pa55');
    }
  });

  describe('in production', () => {
    const production = {
      ...valid,
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://tempo.example.com',
      WEB_APP_URL: 'https://tempo.example.com',
    };

    it('accepts real secrets over https', () => {
      expect(parseEnv(production).NODE_ENV).toBe('production');
    });

    it('refuses the example secrets', () => {
      const run = () =>
        parseEnv({
          ...production,
          JWT_SECRET: 'change-me-dev-only-jwt-secret-at-least-32-chars',
          TOTP_ENCRYPTION_KEY: 'ZGV2LW9ubHktdG90cC1rZXktY2hhbmdlLW1lLTMyYiE=',
        });
      expect(run).toThrow(/JWT_SECRET: is the example value/);
      expect(run).toThrow(/TOTP_ENCRYPTION_KEY: is the example value/);
    });

    it('requires https origins and links', () => {
      expect(() => parseEnv({ ...production, WEB_APP_URL: 'http://tempo.example.com' })).toThrow(
        /WEB_APP_URL: must be https/,
      );
      expect(() =>
        parseEnv({ ...production, CORS_ORIGINS: 'https://a.example.com,http://b.example.com' }),
      ).toThrow(/CORS_ORIGINS: must all be https/);
    });

    it('does not apply these checks outside production', () => {
      expect(() =>
        parseEnv({ ...valid, JWT_SECRET: 'change-me-dev-only-jwt-secret-at-least-32-chars' }),
      ).not.toThrow();
    });
  });
});
