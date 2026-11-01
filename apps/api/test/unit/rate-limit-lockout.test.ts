import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from '../../src/middleware/rate-limit.ts';
import { requireAllowedOrigin } from '../../src/middleware/origin-check.ts';
import { createUnknownEmailLockout, lockDurationMs } from '../../src/modules/auth/lockout.ts';
import { errorHandler } from '../../src/middleware/error-handler.ts';
import { silentLogger } from './helpers.ts';

function clockAt(ms: number) {
  let now = ms;
  return { clock: () => new Date(now), advance: (delta: number) => (now += delta) };
}

describe('rate limiter', () => {
  function app(clock: () => Date) {
    const rateLimit = createRateLimiter(clock);
    const a = express();
    a.get('/x', rateLimit({ name: 'x', windowMs: 60_000, max: 2 }), (_req, res) => {
      res.send('ok');
    });
    a.use(errorHandler(silentLogger));
    return a;
  }

  it('allows max requests per window, then 429 with Retry-After, then resets', async () => {
    const time = clockAt(Date.parse('2026-10-31T10:00:00Z'));
    const a = app(time.clock);
    expect((await request(a).get('/x')).status).toBe(200);
    const second = await request(a).get('/x');
    expect(second.headers['ratelimit-remaining']).toBe('0');
    const third = await request(a).get('/x');
    expect(third.status).toBe(429);
    expect(third.headers['retry-after']).toBe('60');
    expect((third.body as { error: { code: string } }).error.code).toBe('TOO_MANY_REQUESTS');

    time.advance(60_000);
    expect((await request(a).get('/x')).status).toBe(200);
  });
});

describe('lockout backoff', () => {
  it.each([
    [4, 0],
    [5, 60_000],
    [6, 120_000],
    [7, 240_000],
    [10, 32 * 60_000],
    [11, 60 * 60_000],
    [50, 60 * 60_000],
  ])('%i failures → %i ms', (count, expected) => {
    expect(lockDurationMs(count)).toBe(expected);
  });

  it('locks unknown emails exactly like real accounts', () => {
    const time = clockAt(0);
    const lockout = createUnknownEmailLockout(time.clock);
    for (let i = 0; i < 4; i++) lockout.recordFailure('ghost@tempo.test');
    expect(lockout.retryAfterMs('ghost@tempo.test')).toBe(0);
    lockout.recordFailure('ghost@tempo.test');
    expect(lockout.retryAfterMs('ghost@tempo.test')).toBe(60_000);
    time.advance(60_000);
    expect(lockout.retryAfterMs('ghost@tempo.test')).toBe(0);
    lockout.recordFailure('ghost@tempo.test');
    expect(lockout.retryAfterMs('ghost@tempo.test')).toBe(120_000);
    expect(lockout.retryAfterMs('other@tempo.test')).toBe(0);
  });
});

describe('origin check', () => {
  const a = express();
  a.post('/x', requireAllowedOrigin(['http://localhost:5173']), (_req, res) => {
    res.send('ok');
  });
  a.use(errorHandler(silentLogger));

  it('allows listed origins', async () => {
    expect((await request(a).post('/x').set('Origin', 'http://localhost:5173')).status).toBe(200);
  });

  it.each([undefined, 'https://evil.example', 'http://localhost:5173.evil.example', 'null'])(
    'rejects origin %j with 403',
    async (origin) => {
      const req = request(a).post('/x');
      if (origin) void req.set('Origin', origin);
      expect((await req).status).toBe(403);
    },
  );
});
