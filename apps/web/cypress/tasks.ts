import { createCipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

/**
 * Node-side helpers for the e2e specs. They talk to the throwaway e2e database only (the runner
 * refuses any database whose name doesn't end in _e2e) and never to the api's internals.
 */
export interface TaskConfig {
  databaseUrl: string;
  outboxDir: string;
  totpKeyBase64: string;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function totpCode(secret: string, at = Date.now()): string {
  const bits = [...secret.toUpperCase()]
    .map((c) => BASE32.indexOf(c).toString(2).padStart(5, '0'))
    .join('');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

const randomBase32 = (length: number) =>
  [...randomBytes(length)].map((b) => BASE32[b % 32]).join('');

/** Same format as the api's secret box: "v1.<iv>.<tag>.<ciphertext>", user id as AAD. */
function seal(keyBase64: string, plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyBase64, 'base64'), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), ciphertext]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export interface ClonedUser {
  id: string;
  email: string;
  name: string;
  role: string;
  timezone: string;
  totpSecret: string | null;
}

export function createTasks(config: TaskConfig) {
  if (!new URL(config.databaseUrl).pathname.endsWith('_e2e'))
    throw new Error('Cypress tasks only run against an *_e2e database');
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4 });
  let counter = 0;

  return {
    /**
     * A brand-new user copied from a seeded one: same password, timezone and project
     * memberships (and rates). Fresh users keep tests independent of each other and of the
     * per-email login limits; `totp` gives them 2FA (required for Super Admins).
     */
    async 'db:cloneUser'(options: {
      from: string;
      role?: string;
      name?: string;
      timezone?: string;
      totp?: boolean;
      memberships?: boolean;
    }): Promise<ClonedUser> {
      const source = await pool.query(
        'SELECT id, password_hash, name, role, timezone FROM users WHERE email = $1',
        [options.from],
      );
      const src = source.rows[0] as
        | { id: string; password_hash: string; name: string; role: string; timezone: string }
        | undefined;
      if (!src) throw new Error(`no seeded user ${options.from}`);
      const id = randomUUID();
      counter += 1;
      const email = `cy.${Date.now().toString(36)}.${counter}.${options.from.split('@')[0]}@tempo.test`;
      const name = options.name ?? `${src.name.split(' ')[0]} Cy${counter}`;
      const role = options.role ?? src.role;
      const timezone = options.timezone ?? src.timezone;
      const totpSecret = options.totp ? randomBase32(32) : null;
      await pool.query(
        `INSERT INTO users (id, email, password_hash, name, role, timezone, is_active,
           totp_secret_encrypted, totp_enabled_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::user_role, $6, true, $7, $8, now(), now())`,
        [
          id,
          email,
          src.password_hash,
          name,
          role,
          timezone,
          totpSecret ? seal(config.totpKeyBase64, totpSecret, id) : null,
          totpSecret ? new Date() : null,
        ],
      );
      if (options.memberships !== false) {
        await pool.query(
          `INSERT INTO project_members (project_id, user_id, role_in_project, hourly_rate)
           SELECT project_id, $1, role_in_project, hourly_rate FROM project_members
           WHERE user_id = $2`,
          [id, src.id],
        );
      }
      return { id, email, name, role, timezone, totpSecret };
    },

    /** The current TOTP code for a secret, from the next 30 s window if `next` is set. */
    totp({ secret, next }: { secret: string; next?: boolean }): string {
      return totpCode(secret, Date.now() + (next ? 30_000 : 0));
    },

    /** Parameterized SQL for test setup and assertions. */
    async 'db:query'({ text, values = [] }: { text: string; values?: unknown[] }) {
      return (await pool.query(text, values)).rows as Record<string, unknown>[];
    },

    /** Newest mail to `to` in the dev outbox, or null if none yet. */
    async 'mail:latest'(to: string) {
      const files = (await readdir(config.outboxDir).catch(() => [] as string[]))
        .filter((f) => f.endsWith(`-${to}.json`))
        .sort();
      const newest = files.at(-1);
      if (!newest) return null;
      return JSON.parse(await readFile(join(config.outboxDir, newest), 'utf8')) as {
        to: string;
        subject: string;
        text: string;
      };
    },

    async 'files:clear'(directory: string) {
      await rm(directory, { recursive: true, force: true });
      return null;
    },
  };
}
