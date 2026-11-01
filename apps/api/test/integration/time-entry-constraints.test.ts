import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createPool,
  createProject,
  createTask,
  createUser,
  insertEntry,
  pgError,
  resetData,
  SQLSTATE,
} from './fixtures.ts';

let pool: pg.Pool;
let userId: string;
let otherUserId: string;
let projectId: string;

beforeAll(() => {
  pool = createPool();
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetData(pool);
  userId = await createUser(pool);
  otherUserId = await createUser(pool);
  projectId = await createProject(pool);
});

const entry = (startedAt: string, endedAt: string | null, user = () => userId) => ({
  userId: user(),
  projectId,
  startedAt,
  endedAt,
});

async function countEntries(forUser: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    'SELECT count(*) AS n FROM time_entries WHERE user_id = $1',
    [forUser],
  );
  return Number(rows[0]?.n);
}

describe('one running timer per user', () => {
  it('rejects a second running entry for the same user', async () => {
    await insertEntry(pool, entry('2026-10-31T09:00:00Z', null));
    const error = await pgError(() => insertEntry(pool, entry('2026-10-31T10:00:00Z', null)));
    expect([SQLSTATE.UNIQUE_VIOLATION, SQLSTATE.EXCLUSION_VIOLATION]).toContain(error.code);
  });

  it('is enforced by the partial unique index on its own', async () => {
    // Two running entries always overlap ([start, ∞)), so the exclusion constraint would also
    // fire. Drop it inside a rolled-back transaction to prove the index alone is enough.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'ALTER TABLE time_entries DROP CONSTRAINT time_entries_no_overlap_per_user',
      );
      await insertEntry(client, entry('2026-10-31T09:00:00Z', null));
      const error = await pgError(() => insertEntry(client, entry('2026-10-31T10:00:00Z', null)));
      expect(error).toEqual({
        code: SQLSTATE.UNIQUE_VIOLATION,
        constraint: 'time_entries_one_running_per_user',
      });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('allows one running entry per user for different users', async () => {
    await insertEntry(pool, entry('2026-10-31T09:00:00Z', null));
    await insertEntry(
      pool,
      entry('2026-10-31T09:00:00Z', null, () => otherUserId),
    );
    expect(await countEntries(otherUserId)).toBe(1);
  });

  it('allows a new running entry once the previous one is stopped', async () => {
    const id = await insertEntry(pool, entry('2026-10-31T09:00:00Z', null));
    await pool.query("UPDATE time_entries SET ended_at = '2026-10-31T10:00:00Z' WHERE id = $1", [
      id,
    ]);
    await insertEntry(pool, entry('2026-10-31T10:00:00Z', null));
    expect(await countEntries(userId)).toBe(2);
  });

  it('lets exactly one of many concurrent start requests win', async () => {
    const attempts = Array.from({ length: 8 }, (_, i) =>
      insertEntry(pool, entry(`2026-10-31T09:0${i}:00Z`, null)),
    );
    const results = await Promise.allSettled(attempts);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) {
      if (result.status === 'rejected') {
        expect([SQLSTATE.UNIQUE_VIOLATION, SQLSTATE.EXCLUSION_VIOLATION]).toContain(
          (result.reason as { code?: string }).code,
        );
      }
    }
    expect(await countEntries(userId)).toBe(1);
  });
});

describe('no overlapping entries per user', () => {
  beforeEach(async () => {
    await insertEntry(pool, entry('2026-10-31T09:00:00Z', '2026-10-31T11:00:00Z'));
  });

  it.each([
    ['overlaps the start', '2026-10-31T08:00:00Z', '2026-10-31T09:30:00Z'],
    ['overlaps the end', '2026-10-31T10:30:00Z', '2026-10-31T12:00:00Z'],
    ['is contained', '2026-10-31T09:30:00Z', '2026-10-31T10:30:00Z'],
    ['contains it', '2026-10-31T08:00:00Z', '2026-10-31T12:00:00Z'],
    ['is identical', '2026-10-31T09:00:00Z', '2026-10-31T11:00:00Z'],
    ['overlaps by one second', '2026-10-31T10:59:59Z', '2026-10-31T12:00:00Z'],
  ])('rejects an entry that %s', async (_label, startedAt, endedAt) => {
    const error = await pgError(() => insertEntry(pool, entry(startedAt, endedAt)));
    expect(error).toEqual({
      code: SQLSTATE.EXCLUSION_VIOLATION,
      constraint: 'time_entries_no_overlap_per_user',
    });
  });

  it('allows back-to-back entries (ranges are half-open)', async () => {
    await insertEntry(pool, entry('2026-10-31T11:00:00Z', '2026-10-31T12:00:00Z'));
    await insertEntry(pool, entry('2026-10-31T08:00:00Z', '2026-10-31T09:00:00Z'));
    expect(await countEntries(userId)).toBe(3);
  });

  it('allows other users to track the same range', async () => {
    await insertEntry(
      pool,
      entry('2026-10-31T09:00:00Z', '2026-10-31T11:00:00Z', () => otherUserId),
    );
    expect(await countEntries(otherUserId)).toBe(1);
  });

  it('treats the same instant written with different offsets as overlapping', async () => {
    // 11:30+04:00 is 07:30Z → overlaps nothing; 13:30+04:00 is 09:30Z → overlaps.
    await insertEntry(pool, entry('2026-10-31T11:30:00+04:00', '2026-10-31T12:30:00+04:00'));
    const error = await pgError(() =>
      insertEntry(pool, entry('2026-10-31T13:30:00+04:00', '2026-10-31T14:00:00+04:00')),
    );
    expect(error.code).toBe(SQLSTATE.EXCLUSION_VIOLATION);
  });

  it('rejects an update that would create an overlap', async () => {
    const id = await insertEntry(pool, entry('2026-10-31T12:00:00Z', '2026-10-31T13:00:00Z'));
    const error = await pgError(() =>
      pool.query("UPDATE time_entries SET started_at = '2026-10-31T10:00:00Z' WHERE id = $1", [id]),
    );
    expect(error.code).toBe(SQLSTATE.EXCLUSION_VIOLATION);
  });

  it('blocks entries after the start of a running timer, but not before it', async () => {
    await insertEntry(pool, entry('2026-10-31T14:00:00Z', null));
    const error = await pgError(() =>
      insertEntry(pool, entry('2026-10-31T15:00:00Z', '2026-10-31T15:30:00Z')),
    );
    expect(error.code).toBe(SQLSTATE.EXCLUSION_VIOLATION);
    await insertEntry(pool, entry('2026-10-31T12:00:00Z', '2026-10-31T14:00:00Z'));
  });

  it('frees the time after a running timer once it is stopped', async () => {
    const id = await insertEntry(pool, entry('2026-10-31T14:00:00Z', null));
    await pool.query("UPDATE time_entries SET ended_at = '2026-10-31T15:00:00Z' WHERE id = $1", [
      id,
    ]);
    await insertEntry(pool, entry('2026-10-31T15:00:00Z', '2026-10-31T16:00:00Z'));
  });

  it('lets only one of two concurrent overlapping inserts win', async () => {
    const results = await Promise.allSettled([
      insertEntry(pool, entry('2026-10-31T13:00:00Z', '2026-10-31T14:00:00Z')),
      insertEntry(pool, entry('2026-10-31T13:30:00Z', '2026-10-31T14:30:00Z')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await countEntries(userId)).toBe(2);
  });
});

describe('ended_at > started_at', () => {
  it.each([
    ['equal to', '2026-10-31T09:00:00Z'],
    ['before', '2026-10-31T08:59:59Z'],
  ])('rejects ended_at %s started_at', async (_label, endedAt) => {
    const error = await pgError(() => insertEntry(pool, entry('2026-10-31T09:00:00Z', endedAt)));
    expect(error).toEqual({
      code: SQLSTATE.CHECK_VIOLATION,
      constraint: 'time_entries_ended_after_started',
    });
  });
});

describe('duration_seconds generated column', () => {
  async function duration(id: string): Promise<number | null> {
    const { rows } = await pool.query<{ duration_seconds: number | null }>(
      'SELECT duration_seconds FROM time_entries WHERE id = $1',
      [id],
    );
    return rows[0]?.duration_seconds ?? null;
  }

  it('is computed from the two instants', async () => {
    const id = await insertEntry(pool, entry('2026-10-31T09:00:00Z', '2026-10-31T10:30:15Z'));
    expect(await duration(id)).toBe(5415);
  });

  it('counts real elapsed time across a DST change (Berlin fall-back: 01:00–04:00 local = 4 h)', async () => {
    const id = await insertEntry(
      pool,
      entry('2026-10-25T01:00:00+02:00', '2026-10-25T04:00:00+01:00'),
    );
    expect(await duration(id)).toBe(4 * 3600);
  });

  it('is null while running and computed on stop', async () => {
    const id = await insertEntry(pool, entry('2026-10-31T22:00:00Z', null));
    expect(await duration(id)).toBeNull();
    await pool.query("UPDATE time_entries SET ended_at = '2026-11-01T01:15:00Z' WHERE id = $1", [
      id,
    ]);
    expect(await duration(id)).toBe(3 * 3600 + 15 * 60);
  });

  it('cannot be written', async () => {
    const id = await insertEntry(pool, entry('2026-10-31T09:00:00Z', '2026-10-31T10:00:00Z'));
    const error = await pgError(() =>
      pool.query('UPDATE time_entries SET duration_seconds = 1 WHERE id = $1', [id]),
    );
    expect(error.code).toBe(SQLSTATE.GENERATED_ALWAYS);
  });

  it('stores instants with second precision (timestamptz(0) rounds sub-second input)', async () => {
    // Callers should truncate to whole seconds before writing; this documents the DB behavior.
    const id = await insertEntry(
      pool,
      entry('2026-10-31T09:00:00.400Z', '2026-10-31T09:00:01.600Z'),
    );
    const { rows } = await pool.query<{ started: string; ended: string }>(
      `SELECT to_char(started_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') AS started,
              to_char(ended_at AT TIME ZONE 'UTC', 'HH24:MI:SS.MS') AS ended
       FROM time_entries WHERE id = $1`,
      [id],
    );
    expect(rows[0]).toEqual({ started: '09:00:00.000', ended: '09:00:02.000' });
    expect(await duration(id)).toBe(2);
  });
});

describe('related invariants', () => {
  it('rejects a task that belongs to another project', async () => {
    const otherProject = await createProject(pool);
    const foreignTask = await createTask(pool, otherProject);
    const error = await pgError(() =>
      insertEntry(pool, {
        ...entry('2026-10-31T09:00:00Z', '2026-10-31T10:00:00Z'),
        taskId: foreignTask,
      }),
    );
    expect(error.code).toBe(SQLSTATE.FOREIGN_KEY_VIOLATION);
  });

  it('accepts a task from the same project', async () => {
    const taskId = await createTask(pool, projectId);
    await insertEntry(pool, { ...entry('2026-10-31T09:00:00Z', '2026-10-31T10:00:00Z'), taskId });
  });

  it('keeps audit_logs append-only', async () => {
    await pool.query(
      "INSERT INTO audit_logs (id, action) VALUES (gen_random_uuid(), 'test.action')",
    );
    expect((await pgError(() => pool.query("UPDATE audit_logs SET action = 'x'"))).code).toBe(
      SQLSTATE.RESTRICT_VIOLATION,
    );
    expect((await pgError(() => pool.query('DELETE FROM audit_logs'))).code).toBe(
      SQLSTATE.RESTRICT_VIOLATION,
    );
  });

  it('allows only a single org_settings row', async () => {
    const error = await pgError(() =>
      pool.query(
        "INSERT INTO org_settings (id, name, default_timezone, updated_at) VALUES (2, 'x', 'UTC', now())",
      ),
    );
    expect(error).toEqual({
      code: SQLSTATE.CHECK_VIOLATION,
      constraint: 'org_settings_single_row',
    });
  });

  it('requires lower-case emails', async () => {
    const error = await pgError(() => createUser(pool, 'Mixed@Tempo.test'));
    expect(error).toEqual({ code: SQLSTATE.CHECK_VIOLATION, constraint: 'users_email_lowercase' });
  });
});
