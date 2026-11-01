import { describe, expect, it } from 'vitest';
import { apiErrorResponseSchema, healthResponseSchema } from '../src/index.ts';

describe('healthResponseSchema', () => {
  it('accepts a valid health payload', () => {
    const payload = { status: 'ok', serverTime: '2026-03-29T01:00:00.000Z', uptimeSeconds: 12.5 };
    expect(healthResponseSchema.parse(payload)).toEqual(payload);
  });

  it('rejects a non-UTC-ISO server time', () => {
    const result = healthResponseSchema.safeParse({
      status: 'ok',
      serverTime: '29/03/2026 01:00',
      uptimeSeconds: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe('apiErrorResponseSchema', () => {
  it('accepts errors with and without details', () => {
    expect(apiErrorResponseSchema.safeParse({ error: { code: 'X', message: 'm' } }).success).toBe(
      true,
    );
    expect(
      apiErrorResponseSchema.safeParse({ error: { code: 'X', message: 'm', details: [1] } })
        .success,
    ).toBe(true);
  });

  it('rejects bodies without an error object', () => {
    expect(apiErrorResponseSchema.safeParse({ message: 'nope' }).success).toBe(false);
  });
});
