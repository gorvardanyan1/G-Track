import { z } from 'zod';

export const ErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_JSON: 'INVALID_JSON',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_TOKEN: 'INVALID_TOKEN',
  INVALID_TWO_FACTOR_CODE: 'INVALID_TWO_FACTOR_CODE',
  TWO_FACTOR_REQUIRED: 'TWO_FACTOR_REQUIRED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  PASSWORD_POLICY: 'PASSWORD_POLICY',
  INVALID_LOCAL_TIME: 'INVALID_LOCAL_TIME',
  INVALID_TIME_RANGE: 'INVALID_TIME_RANGE',
  TIME_ENTRY_OVERLAP: 'TIME_ENTRY_OVERLAP',
  PERIOD_LOCKED: 'PERIOD_LOCKED',
  TIMESHEET_APPROVAL_DISABLED: 'TIMESHEET_APPROVAL_DISABLED',
  TIMESHEET_NOT_SUBMITTABLE: 'TIMESHEET_NOT_SUBMITTABLE',
  TIMESHEET_NOT_PENDING: 'TIMESHEET_NOT_PENDING',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Shape of every error response body: { error: { code, message, details? } }. */
export const apiErrorResponseSchema = z.object({
  error: z.object({
    // Kept as a plain string so older clients tolerate codes added later.
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>;
