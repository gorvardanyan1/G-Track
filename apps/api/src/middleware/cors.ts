import cors from 'cors';
import type { RequestHandler } from 'express';
import { REQUEST_ID_HEADER, SERVER_TIME_HEADER } from '@tempo/shared';

/** Strict allowlist: origins not listed get no CORS headers, so browsers block the response. */
export function corsAllowlist(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return cors({
    origin: (origin, callback) => callback(null, origin !== undefined && allowed.has(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    exposedHeaders: [SERVER_TIME_HEADER, REQUEST_ID_HEADER],
    maxAge: 600,
  });
}
