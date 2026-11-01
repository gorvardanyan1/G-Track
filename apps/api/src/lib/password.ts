import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

/** OWASP-recommended argon2id baseline: 19 MiB memory, 2 passes, 1 lane. */
const DEFAULT_PARAMS = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 } as const;
const SALT_BYTES = 16;

// PHC string format: $argon2id$v=19$m=<KiB>,t=<passes>,p=<lanes>$<salt>$<hash>
const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '');

async function derive(
  password: string,
  salt: Buffer,
  params: Omit<Argon2Parameters, 'message' | 'nonce'>,
) {
  return argon2Async('argon2id', { ...params, message: password, nonce: salt });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, DEFAULT_PARAMS);
  const { memory, passes, parallelism } = DEFAULT_PARAMS;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(salt)}$${b64(hash)}`;
}

/** Constant-time check. Returns false (never throws) for malformed stored hashes. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = PHC.exec(stored);
  if (!match) return false;
  const [, memory, passes, parallelism, salt = '', hash = ''] = match;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: expected.length,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
