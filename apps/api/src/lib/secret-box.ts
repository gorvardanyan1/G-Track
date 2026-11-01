import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** AES-256-GCM for small secrets at rest (TOTP seeds). Output: "v1.<iv>.<tag>.<ciphertext>". */
export interface SecretBox {
  /** `context` (e.g. the user id) is authenticated, so a ciphertext can't be moved to another row. */
  encrypt(plaintext: string, context: string): string;
  decrypt(sealed: string, context: string): string;
}

export function createSecretBox(keyBase64: string): SecretBox {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) throw new RangeError('Secret box key must be 32 bytes (base64)');

  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(context));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      return ['v1', iv, cipher.getAuthTag(), ciphertext]
        .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
        .join('.');
    },
    decrypt(sealed, context) {
      const [version, iv, tag, ciphertext] = sealed.split('.');
      if (version !== 'v1' || !iv || !tag || ciphertext === undefined) {
        throw new Error('Unsupported secret format');
      }
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    },
  };
}
