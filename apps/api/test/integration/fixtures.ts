import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { testDatabaseUrl } from './test-database.ts';

/** Raw pg pool: these tests assert what the *database* enforces, independent of Prisma. */
export function createPool(): pg.Pool {
  return new pg.Pool({ connectionString: testDatabaseUrl(), max: 10 });
}

export async function resetData(pool: pg.Pool): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE audit_logs, time_entries, timesheets, project_members, tasks, projects,
      clients, refresh_tokens, recovery_codes, password_resets, invites, org_settings, users
    RESTART IDENTITY CASCADE`);
}

export async function createUser(
  pool: pg.Pool,
  email = `${randomUUID()}@tempo.test`,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO users (id, email, password_hash, name, timezone, updated_at)
     VALUES ($1, $2, 'x', 'Test User', 'Europe/Berlin', now())`,
    [id, email],
  );
  return id;
}

export async function createProject(pool: pg.Pool): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO projects (id, name, color, updated_at) VALUES ($1, $2, '#5B5BF7', now())`,
    [id, `Project ${id.slice(0, 8)}`],
  );
  return id;
}

export async function createTask(pool: pg.Pool, projectId: string): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO tasks (id, project_id, name, updated_at) VALUES ($1, $2, 'Task', now())`,
    [id, projectId],
  );
  return id;
}

export interface EntryInput {
  userId: string;
  projectId: string;
  startedAt: string;
  endedAt: string | null;
  taskId?: string | null;
}

export async function insertEntry(
  pool: pg.Pool | pg.PoolClient,
  entry: EntryInput,
): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO time_entries (id, user_id, project_id, task_id, started_at, ended_at, source, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'MANUAL', now())`,
    [id, entry.userId, entry.projectId, entry.taskId ?? null, entry.startedAt, entry.endedAt],
  );
  return id;
}

/** Runs `fn` and returns the Postgres error it raised (SQLSTATE + constraint), or fails. */
export async function pgError(
  fn: () => Promise<unknown>,
): Promise<{ code: string; constraint?: string }> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof pg.DatabaseError) {
      return {
        code: err.code ?? '',
        ...(err.constraint !== undefined && { constraint: err.constraint }),
      };
    }
    throw err;
  }
  throw new Error('Expected the database to reject the statement, but it succeeded');
}

export const SQLSTATE = {
  UNIQUE_VIOLATION: '23505',
  EXCLUSION_VIOLATION: '23P01',
  CHECK_VIOLATION: '23514',
  FOREIGN_KEY_VIOLATION: '23503',
  RESTRICT_VIOLATION: '23001',
  GENERATED_ALWAYS: '428C9',
} as const;
