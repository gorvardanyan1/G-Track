import { z } from 'zod';
import { isValidTimeZone } from '../time/zones.ts';
import { PASSWORD_MAX_LENGTH } from './password-policy.ts';
import { USER_ROLES } from './roles.ts';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Login accepts any length up to the cap; the policy only applies when setting a password. */
const passwordInput = z.string().min(1).max(PASSWORD_MAX_LENGTH);
const opaqueToken = z.string().min(20).max(512);
const totpCode = z.string().regex(/^\d{6}$/, 'must be 6 digits');

export const timezoneSchema = z.string().refine(isValidTimeZone, 'must be an IANA time zone');

export const loginRequestSchema = z.object({ email: emailSchema, password: passwordInput });

export const twoFactorLoginRequestSchema = z
  .object({
    challengeToken: opaqueToken.max(2048),
    code: totpCode.optional(),
    recoveryCode: z.string().min(8).max(32).optional(),
  })
  .refine((v) => (v.code === undefined) !== (v.recoveryCode === undefined), {
    message: 'provide either code or recoveryCode',
  });

export const createInviteRequestSchema = z.object({
  email: emailSchema,
  role: z.enum(USER_ROLES),
});

export const inviteTokenRequestSchema = z.object({ token: opaqueToken });

export const acceptInviteRequestSchema = z.object({
  token: opaqueToken,
  name: z.string().trim().min(1).max(100),
  password: passwordInput,
  timezone: timezoneSchema,
});

export const forgotPasswordRequestSchema = z.object({ email: emailSchema });

export const resetPasswordRequestSchema = z.object({ token: opaqueToken, password: passwordInput });

export const twoFactorCodeRequestSchema = z.object({ code: totpCode });

export const disableTwoFactorRequestSchema = z.object({ password: passwordInput, code: totpCode });

export const updateProfileRequestSchema = z
  .object({ name: z.string().trim().min(1).max(100), timezone: timezoneSchema })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'nothing to update');

export const changePasswordRequestSchema = z.object({
  currentPassword: passwordInput,
  newPassword: passwordInput,
});

export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type TwoFactorLoginRequest = z.infer<typeof twoFactorLoginRequestSchema>;
export type CreateInviteRequest = z.infer<typeof createInviteRequestSchema>;
export type InviteTokenRequest = z.infer<typeof inviteTokenRequestSchema>;
export type AcceptInviteRequest = z.infer<typeof acceptInviteRequestSchema>;
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;
export type TwoFactorCodeRequest = z.infer<typeof twoFactorCodeRequestSchema>;
export type DisableTwoFactorRequest = z.infer<typeof disableTwoFactorRequestSchema>;

// ─── responses ──────────────────────────────────────────────────────────────────

export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: z.enum(USER_ROLES),
  timezone: z.string(),
  twoFactorEnabled: z.boolean(),
});

export const authenticatedResponseSchema = z.object({
  status: z.literal('authenticated'),
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  user: authUserSchema,
});

export const loginResponseSchema = z.discriminatedUnion('status', [
  authenticatedResponseSchema,
  z.object({ status: z.literal('two_factor_required'), challengeToken: z.string() }),
  z.object({ status: z.literal('two_factor_setup_required'), setupToken: z.string() }),
]);

export const inviteResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: z.enum(USER_ROLES),
  expiresAt: z.iso.datetime(),
});

export const twoFactorSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUrl: z.string(),
});

export const twoFactorEnabledResponseSchema = z.object({
  recoveryCodes: z.array(z.string()),
  /** Present when 2FA was set up during login (setup token): the session that login started. */
  session: authenticatedResponseSchema.optional(),
});

export type AuthUser = z.infer<typeof authUserSchema>;
export type AuthenticatedResponse = z.infer<typeof authenticatedResponseSchema>;
export type LoginResponse = z.infer<typeof loginResponseSchema>;
export type InviteResponse = z.infer<typeof inviteResponseSchema>;
export type TwoFactorSetupResponse = z.infer<typeof twoFactorSetupResponseSchema>;
export type TwoFactorEnabledResponse = z.infer<typeof twoFactorEnabledResponseSchema>;
