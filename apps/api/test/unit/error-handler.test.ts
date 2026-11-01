import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { apiErrorResponseSchema } from '@tempo/shared';
import { z } from 'zod';
import { ConflictError, ForbiddenError, NotFoundError } from '../../src/errors/app-error.ts';
import { buildErrorTestApp } from './helpers.ts';

describe('central error handler', () => {
  it.each([
    [new NotFoundError('Project not found'), 404, 'NOT_FOUND', 'Project not found'],
    [new ForbiddenError(), 403, 'FORBIDDEN', 'Forbidden'],
    [new ConflictError('Timer already running'), 409, 'CONFLICT', 'Timer already running'],
  ])('maps %o to its status and code', async (error, status, code, message) => {
    const app = buildErrorTestApp((a) =>
      a.get('/boom', () => {
        throw error;
      }),
    );
    const res = await request(app).get('/boom');
    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: { code, message } });
  });

  it('includes details when present', async () => {
    const app = buildErrorTestApp((a) =>
      a.get('/boom', () => {
        throw new ConflictError('Overlap', { details: { entryId: 'abc' } });
      }),
    );
    const res = await request(app).get('/boom');
    expect(apiErrorResponseSchema.parse(res.body).error.details).toEqual({ entryId: 'abc' });
  });

  it('turns ZodErrors into 400 VALIDATION_ERROR with issue details', async () => {
    const schema = z.object({ name: z.string().min(1) });
    const app = buildErrorTestApp((a) =>
      a.post('/validate', (req, res) => {
        res.json(schema.parse(req.body));
      }),
    );
    const res = await request(app).post('/validate').send({ name: '' });
    expect(res.status).toBe(400);
    const { error } = apiErrorResponseSchema.parse(res.body);
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.details).toEqual([expect.objectContaining({ path: 'name', code: 'too_small' })]);
  });

  it('hides internals of unexpected errors behind a generic 500', async () => {
    const app = buildErrorTestApp((a) =>
      a.get('/boom', () => {
        throw new Error('db password is hunter2');
      }),
    );
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('catches rejected promises from async handlers', async () => {
    const app = buildErrorTestApp((a) =>
      a.get('/async', async () => {
        await Promise.resolve();
        throw new NotFoundError();
      }),
    );
    const res = await request(app).get('/async');
    expect(res.status).toBe(404);
  });

  it('keeps X-Server-Time on error responses', async () => {
    const app = buildErrorTestApp((a) =>
      a.get('/boom', () => {
        throw new Error('x');
      }),
    );
    const res = await request(app).get('/boom');
    expect(res.headers['x-server-time']).toMatch(/^\d+$/);
  });
});
