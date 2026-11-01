import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiErrorResponseSchema } from '@tempo/shared';
import { buildTestApp } from './helpers.ts';

describe('X-Server-Time header', () => {
  it.each([
    ['success', '/api/v1/health'],
    ['unknown route', '/api/v1/does-not-exist'],
  ])('is present on %s responses as UTC epoch ms', async (_label, path) => {
    const before = Date.now();
    const res = await request(buildTestApp()).get(path);
    const after = Date.now();

    const header = res.headers['x-server-time'];
    expect(header).toMatch(/^\d+$/);
    const value = Number(header);
    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(after);
  });

  it('is present on error responses from the body parser', async () => {
    const res = await request(buildTestApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.headers['x-server-time']).toMatch(/^\d+$/);
  });
});

describe('request id', () => {
  it('generates a UUID when none is sent', async () => {
    const res = await request(buildTestApp()).get('/api/v1/health');
    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('reuses a safe incoming id', async () => {
    const res = await request(buildTestApp())
      .get('/api/v1/health')
      .set('X-Request-Id', 'proxy-abc.123');
    expect(res.headers['x-request-id']).toBe('proxy-abc.123');
  });

  it('replaces an unsafe incoming id', async () => {
    const res = await request(buildTestApp())
      .get('/api/v1/health')
      .set('X-Request-Id', 'bad id\twith spaces');
    expect(res.headers['x-request-id']).not.toBe('bad id\twith spaces');
  });
});

describe('CORS allowlist', () => {
  it('allows listed origins with credentials and exposes timing headers', async () => {
    const res = await request(buildTestApp())
      .get('/api/v1/health')
      .set('Origin', 'http://localhost:5173');
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-expose-headers']).toContain('X-Server-Time');
  });

  it('sends no CORS headers for other origins', async () => {
    const res = await request(buildTestApp())
      .get('/api/v1/health')
      .set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers preflight only for listed origins', async () => {
    const ok = await request(buildTestApp())
      .options('/api/v1/health')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');

    const denied = await request(buildTestApp())
      .options('/api/v1/health')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('security headers', () => {
  it('sets helmet headers and hides x-powered-by', async () => {
    const res = await request(buildTestApp()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('body parsing', () => {
  it('rejects bodies over the limit with 413', async () => {
    const res = await request(buildTestApp())
      .post('/api/v1/health')
      .send({ data: 'x'.repeat(2048) });
    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' },
    });
  });

  it('rejects malformed JSON with 400 INVALID_JSON', async () => {
    const res = await request(buildTestApp())
      .post('/api/v1/health')
      .set('Content-Type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(apiErrorResponseSchema.parse(res.body).error.code).toBe('INVALID_JSON');
  });
});

describe('unknown routes', () => {
  it('return the standard 404 error body', async () => {
    const res = await request(buildTestApp()).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
});
