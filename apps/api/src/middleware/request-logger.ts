import type { RequestHandler } from 'express';
import type { Logger } from 'pino';

/** Logs one line per request. Never logs bodies, headers or query strings (may hold tokens). */
export function requestLogger(logger: Logger): RequestHandler {
  return (req, res, next) => {
    const startedAt = process.hrtime.bigint();
    req.log = logger.child({ requestId: req.id });

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      req.log[level](
        {
          method: req.method,
          path: req.originalUrl.split('?', 1)[0],
          statusCode: res.statusCode,
          durationMs: Math.round(durationMs * 10) / 10,
        },
        'request completed',
      );
    });

    next();
  };
}
