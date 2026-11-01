export const PASSWORD_MIN_LENGTH = 12;
/** Upper bound keeps hashing cost bounded (argon2 DoS protection). */
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordIssue =
  'TOO_SHORT' | 'TOO_LONG' | 'TOO_COMMON' | 'CONTAINS_PERSONAL_INFO' | 'REPEATED_CHARACTERS';

export const PASSWORD_ISSUE_MESSAGES: Readonly<Record<PasswordIssue, string>> = {
  TOO_SHORT: `Use at least ${PASSWORD_MIN_LENGTH} characters`,
  TOO_LONG: `Use at most ${PASSWORD_MAX_LENGTH} characters`,
  TOO_COMMON: 'This password is too common',
  CONTAINS_PERSONAL_INFO: 'Don’t use your name or email address in your password',
  REPEATED_CHARACTERS: 'Don’t use the same character over and over',
};

// Lower-cased; checked after removing digits/symbols at the edges ("Password123!" → "password").
const COMMON_PASSWORDS = new Set([
  'password',
  'passwordpassword',
  'qwertyuiop',
  'qwertyuiopasdf',
  'qwerty',
  'letmein',
  'welcome',
  'iloveyou',
  'administrator',
  'admin',
  'changeme',
  'trustno',
  'football',
  'baseball',
  'sunshine',
  'princess',
  'dragon',
  'monkey',
  'tempo',
  'timetracker',
  'abcdefghijkl',
  'abc',
]);

const DIGIT_RUNS = /^(0123456789|1234567890|0987654321|9876543210)+/;

/**
 * NIST 800-63B style policy: length plus a few blocklist checks, no composition rules.
 * Shared so the web form and the api report exactly the same problems.
 */
export function checkPasswordPolicy(
  password: string,
  context: { email?: string; name?: string } = {},
): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) issues.push('TOO_SHORT');
  if (length > PASSWORD_MAX_LENGTH) issues.push('TOO_LONG');

  const lower = password.toLowerCase();
  const core = lower.replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (COMMON_PASSWORDS.has(core) || COMMON_PASSWORDS.has(lower) || DIGIT_RUNS.test(lower)) {
    issues.push('TOO_COMMON');
  }

  const personal = [
    context.email?.toLowerCase().split('@')[0],
    ...(context.name?.toLowerCase().split(/\s+/) ?? []),
  ].filter((part): part is string => part !== undefined && part.length >= 3);
  if (personal.some((part) => lower.includes(part))) issues.push('CONTAINS_PERSONAL_INFO');

  if (/(.)\1{3,}/u.test(password) || new Set(password).size < 4) issues.push('REPEATED_CHARACTERS');
  return issues;
}
