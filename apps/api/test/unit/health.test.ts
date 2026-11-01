import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@tempo/shared';
import { buildTestApp } from './helpers.ts';

describe('GET /api/v1/health', () => {
  it('returns ok with the server time', async () => {
    const before = Date.now();
    const res = await request(buildTestApp()).get('/api/v1/health');
    const after = Date.now();

    expect(res.status).toBe(200);
    const body = healthResponseSchema.parse(res.body);
    const serverTime = Date.parse(body.serverTime);
    expect(serverTime).toBeGreaterThanOrEqual(before);
    expect(serverTime).toBeLessThanOrEqual(after);
  });

  it('is not cacheable', async () => {
    const res = await request(buildTestApp()).get('/api/v1/health');
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
