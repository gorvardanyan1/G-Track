import { z } from 'zod';
import { isValidIsoDate } from '../time/calendar.ts';

/** A calendar date ("YYYY-MM-DD"), always interpreted in some user's timezone. */
export const localDateSchema = z.string().refine(isValidIsoDate, 'must be a date like 2026-10-31');

/** Inclusive local `from`/`to` dates; combine with `withDateRangeLimit`. */
export const dateRangeFields = { from: localDateSchema, to: localDateSchema };

/** Requires from ≤ to and a range of at most `maxDays` days. */
export function withDateRangeLimit<S extends z.ZodType<{ from: string; to: string }>>(
  schema: S,
  maxDays: number,
) {
  return schema
    .refine((q) => q.from <= q.to, { message: '"to" must not be before "from"', path: ['to'] })
    .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < maxDays, {
      message: `at most ${maxDays} days`,
      path: ['to'],
    });
}

/** A query parameter given once or repeated (?id=a&id=b), or comma separated (?id=a,b). */
export function queryList<T extends z.ZodType<string, string>>(item: T, max = 100) {
  return z
    .union([z.string(), z.array(z.string())])
    .transform((value) =>
      (Array.isArray(value) ? value : [value])
        .flatMap((v) => v.split(','))
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).max(max));
}
