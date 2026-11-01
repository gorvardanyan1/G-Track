import { createHash, randomBytes } from 'node:crypto';

/** URL-safe random token with `bytes` of entropy (default 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Tokens are stored only as SHA-256 hashes; they are high-entropy, so no slow hash is needed. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
