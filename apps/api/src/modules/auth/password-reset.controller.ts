import type { RequestHandler } from 'express';
import type { ForgotPasswordRequest, ResetPasswordRequest } from '@tempo/shared';
import { requestContext } from '../../lib/request-context.ts';
import type { PasswordResetService } from './password-reset.service.ts';

export const FORGOT_PASSWORD_RESPONSE = {
  message: 'If an account exists for this email, we sent a link to reset the password.',
} as const;

export function createPasswordResetController(resets: PasswordResetService) {
  const forgot: RequestHandler = (req, res) => {
    resets.request(req.body as ForgotPasswordRequest, requestContext(req));
    res.status(202).json(FORGOT_PASSWORD_RESPONSE);
  };

  const reset: RequestHandler = async (req, res) => {
    await resets.reset(req.body as ResetPasswordRequest, requestContext(req));
    res.status(204).end();
  };

  return { forgot, reset };
}
