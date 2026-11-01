import { ZodError } from 'zod';
import {
  AppError,
  BadRequestError,
  InternalError,
  InvalidJsonError,
  PayloadTooLargeError,
  UnsupportedMediaTypeError,
  ValidationError,
} from './app-error.ts';

/** Errors raised by Express' body parser carry a `type` and an HTTP `status`. */
interface HttpLikeError {
  type?: unknown;
  status?: unknown;
  expose?: unknown;
}

function isHttpLikeError(err: unknown): err is HttpLikeError & Error {
  return err instanceof Error && 'status' in err;
}

/** Normalizes anything thrown into an AppError; unknown errors become a generic 500. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new ValidationError(
      err.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: issue.code,
        message: issue.message,
      })),
    );
  }

  if (isHttpLikeError(err)) {
    switch (err.type) {
      case 'entity.parse.failed':
        return new InvalidJsonError({ cause: err });
      case 'entity.too.large':
        return new PayloadTooLargeError();
      case 'charset.unsupported':
      case 'encoding.unsupported':
        return new UnsupportedMediaTypeError();
    }
    if (typeof err.status === 'number' && err.status >= 400 && err.status < 500) {
      return new BadRequestError('Bad request', { cause: err });
    }
  }

  return new InternalError({ cause: err });
}
