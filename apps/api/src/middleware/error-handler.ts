import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorResponse } from '@tempo/shared';
import type { Logger } from 'pino';
import { NotFoundError, TooManyRequestsError } from '../errors/app-error.ts';
import { toAppError } from '../errors/to-app-error.ts';

export function notFound(): RequestHandler {
  return () => {
    throw new NotFoundError('Route not found');
  };
}

export function errorHandler(fallbackLogger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    const appError = toAppError(err);
    const log = (req.log as Logger | undefined) ?? fallbackLogger;
    if (appError.status >= 500) {
      log.error({ err }, 'unhandled error');
    } else {
      log.debug({ code: appError.code }, appError.message);
    }

    const body: ApiErrorResponse = {
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details !== undefined && { details: appError.details }),
      },
    };
    if (appError instanceof TooManyRequestsError && appError.retryAfterSeconds !== undefined) {
      res.setHeader('Retry-After', String(appError.retryAfterSeconds));
    }
    res.status(appError.status).json(body);
  };
}
