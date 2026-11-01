import type { Request, RequestHandler } from 'express';
import type { z } from 'zod';
import { NotFoundError } from '../errors/app-error.ts';

/** Replaces req.body with the parsed value: unknown keys stripped, invalid input → 400. */
export function validateBody(schema: z.ZodType): RequestHandler {
  return (req, _res, next) => {
    req.body = schema.parse(req.body ?? {});
    next();
  };
}

/** Parses the query string into req.validated.query; invalid input → 400. */
export function validateQuery(schema: z.ZodType): RequestHandler {
  return (req, _res, next) => {
    req.validated = { ...req.validated, query: schema.parse(req.query) };
    next();
  };
}

/** Parses path params into req.validated.params. A malformed id can't exist, so it is a 404. */
export function validateParams(schema: z.ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) throw new NotFoundError();
    req.validated = { ...req.validated, params: result.data };
    next();
  };
}

export const validatedQuery = <T>(req: Request): T => req.validated?.query as T;
export const validatedParams = <T>(req: Request): T => req.validated?.params as T;
export const validatedBody = <T>(req: Request): T => req.body as T;
