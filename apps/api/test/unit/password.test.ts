import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../../src/lib/password.ts';

describe('password hashing (argon2id)', () => {
  it('produces a PHC string with OWASP parameters and verifies it', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(
      /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/,
    );
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('returns false for malformed or foreign hashes', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', '$2b$10$abcdefghijklmnopqrstuv')).toBe(false);
    expect(await verifyPassword('x', '$argon2i$v=19$m=19456,t=2,p=1$abc$def')).toBe(false);
  });

  it('verifies hashes created with other cost parameters', async () => {
    // Hash for "pw" with m=8192,t=1,p=1, salt "c2FsdHNhbHRzYWx0c2FsdA" — produced by this module
    // with lowered params, so stored hashes stay verifiable after a cost upgrade.
    const { argon2Sync } = await import('node:crypto');
    const salt = Buffer.from('saltsaltsaltsalt');
    const tag = argon2Sync('argon2id', {
      message: 'pw',
      nonce: salt,
      memory: 8192,
      passes: 1,
      parallelism: 1,
      tagLength: 32,
    });
    const stored = `$argon2id$v=19$m=8192,t=1,p=1$${salt.toString('base64').replace(/=+$/, '')}$${tag.toString('base64').replace(/=+$/, '')}`;
    expect(await verifyPassword('pw', stored)).toBe(true);
  });
});
