import { z } from 'zod';

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
  });
}

/** Query-string booleans: "true" / "false" only. */
export const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');

/** Path ids are UUIDs; anything else is treated as "not found". */
export const idParamsSchema = z.object({ id: z.uuid() });

/** Money / hours with at most two decimals (stored as numeric(10, 2)). */
export const twoDecimals = z
  .number()
  .finite()
  .max(99_999_999.99)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, 'at most 2 decimals');
