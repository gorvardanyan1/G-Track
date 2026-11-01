import { checkPasswordPolicy, ErrorCode, PASSWORD_ISSUE_MESSAGES } from '@tempo/shared';
import { ValidationError } from '../../errors/app-error.ts';

/** Throws a 400 PASSWORD_POLICY error listing every problem (same rules as the web form). */
export function assertPasswordPolicy(
  password: string,
  context: { email: string; name: string },
): void {
  const issues = checkPasswordPolicy(password, context);
  if (issues.length > 0) {
    throw new ValidationError(
      issues.map((issue) => ({
        path: 'password',
        code: issue,
        message: PASSWORD_ISSUE_MESSAGES[issue],
      })),
      'Password does not meet the requirements',
      ErrorCode.PASSWORD_POLICY,
    );
  }
}
