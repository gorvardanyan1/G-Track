import { describe, expect, it } from 'vitest';
import { createSecretBox } from '../../src/lib/secret-box.ts';

const key = Buffer.alloc(32, 9).toString('base64');

describe('secret box (AES-256-GCM)', () => {
  it('round-trips and uses a fresh IV each time', () => {
    const box = createSecretBox(key);
    const a = box.encrypt('JBSWY3DPEHPK3PXP', 'user-1');
    const b = box.encrypt('JBSWY3DPEHPK3PXP', 'user-1');
    expect(a).not.toBe(b);
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(box.decrypt(a, 'user-1')).toBe('JBSWY3DPEHPK3PXP');
  });

  it('refuses a ciphertext moved to another user (bound context)', () => {
    const box = createSecretBox(key);
    expect(() => box.decrypt(box.encrypt('secret', 'user-1'), 'user-2')).toThrow();
  });

  it('detects tampering', () => {
    const box = createSecretBox(key);
    const parts = box.encrypt('secret', 'user-1').split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => box.decrypt(parts.join('.'), 'user-1')).toThrow();
  });

  it('rejects wrong keys and formats', () => {
    expect(() => createSecretBox(Buffer.alloc(16).toString('base64'))).toThrow(RangeError);
    const sealed = createSecretBox(key).encrypt('secret', 'u');
    expect(() =>
      createSecretBox(Buffer.alloc(32, 1).toString('base64')).decrypt(sealed, 'u'),
    ).toThrow();
    expect(() => createSecretBox(key).decrypt('v2.a.b.c', 'u')).toThrow(
      'Unsupported secret format',
    );
  });
});
