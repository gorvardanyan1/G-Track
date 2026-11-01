import type { Logger } from 'pino';
import type { AuthContext } from '../modules/auth/auth.types.ts';

declare global {
  namespace Express {
    interface Request {
      /** Correlation id, also returned in the X-Request-Id header. */
      id: string;
      /** Request-scoped child logger carrying the request id. */
      log: Logger;
      /** Set by the authenticate middleware. */
      auth?: AuthContext;
      /** Parsed query/params from validateQuery / validateParams (Express 5's req.query is read-only). */
      validated?: { query?: unknown; params?: unknown };
    }
  }
}

export {};
