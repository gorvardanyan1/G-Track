import { ErrorCode } from '@tempo/shared';

interface AppErrorOptions {
  details?: unknown;
  cause?: unknown;
}

/** Base class for errors that map to a well-defined HTTP response. */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details: unknown;

  constructor(status: number, code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = options.details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request', options?: AppErrorOptions & { code?: ErrorCode }) {
    super(400, options?.code ?? ErrorCode.BAD_REQUEST, message, options);
  }
}

export class InvalidJsonError extends AppError {
  constructor(options?: AppErrorOptions) {
    super(400, ErrorCode.INVALID_JSON, 'Request body is not valid JSON', options);
  }
}

export class ValidationError extends AppError {
  constructor(
    details: unknown,
    message = 'Request validation failed',
    code: ErrorCode = ErrorCode.VALIDATION_ERROR,
  ) {
    super(400, code, message, { details });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required', code: ErrorCode = ErrorCode.UNAUTHORIZED) {
    super(401, code, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', code: ErrorCode = ErrorCode.FORBIDDEN) {
    super(403, code, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, ErrorCode.NOT_FOUND, message);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict', options?: AppErrorOptions & { code?: ErrorCode }) {
    super(409, options?.code ?? ErrorCode.CONFLICT, message, options);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor() {
    super(413, ErrorCode.PAYLOAD_TOO_LARGE, 'Request body is too large');
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'Unsupported media type') {
    super(415, ErrorCode.UNSUPPORTED_MEDIA_TYPE, message);
  }
}

export class TooManyRequestsError extends AppError {
  /** Sent as the Retry-After header. */
  readonly retryAfterSeconds: number | undefined;

  constructor(message = 'Too many requests', retryAfterSeconds?: number) {
    super(429, ErrorCode.TOO_MANY_REQUESTS, message);
    this.retryAfterSeconds =
      retryAfterSeconds === undefined ? undefined : Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

export class InternalError extends AppError {
  constructor(options?: AppErrorOptions) {
    super(500, ErrorCode.INTERNAL_ERROR, 'Internal server error', options);
  }
}
