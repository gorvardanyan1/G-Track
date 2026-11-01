import {
  authenticatedResponseSchema,
  authUserSchema,
  inviteResponseSchema,
  loginResponseSchema,
  twoFactorEnabledResponseSchema,
  twoFactorSetupResponseSchema,
  type AcceptInviteRequest,
  type ChangePasswordRequest,
  type LoginRequest,
  type TwoFactorLoginRequest,
  type UpdateProfileRequest,
} from '@tempo/shared';
import { http } from './client.ts';

const pub = { auth: false } as const;

export const authApi = {
  login: (body: LoginRequest) =>
    http.request('/auth/login', loginResponseSchema, { ...pub, method: 'POST', body }),
  loginTwoFactor: (body: TwoFactorLoginRequest) =>
    http.request('/auth/login/2fa', authenticatedResponseSchema, { ...pub, method: 'POST', body }),
  logout: () => http.send('/auth/logout', { ...pub, method: 'POST' }),
  logoutAll: () => http.send('/auth/logout-all', { method: 'POST' }),
  me: () => http.request('/auth/me', authUserSchema),
  updateProfile: (body: UpdateProfileRequest) =>
    http.request('/auth/me', authUserSchema, { method: 'PATCH', body }),
  changePassword: (body: ChangePasswordRequest) =>
    http.send('/auth/password', { method: 'POST', body }),

  /** With a setup token (forced enrolment at login) or the session (optional 2FA). */
  startTwoFactorSetup: (token?: string) =>
    http.request('/auth/2fa/setup', twoFactorSetupResponseSchema, {
      method: 'POST',
      ...(token && { token }),
    }),
  enableTwoFactor: (code: string, token?: string) =>
    http.request('/auth/2fa/enable', twoFactorEnabledResponseSchema, {
      method: 'POST',
      body: { code },
      ...(token && { token }),
    }),
  disableTwoFactor: (password: string, code: string) =>
    http.send('/auth/2fa/disable', { method: 'POST', body: { password, code } }),

  inspectInvite: (token: string) =>
    http.request('/auth/invites/inspect', inviteResponseSchema, {
      ...pub,
      method: 'POST',
      body: { token },
    }),
  acceptInvite: (body: AcceptInviteRequest) =>
    http.request('/auth/invites/accept', loginResponseSchema, { ...pub, method: 'POST', body }),
  forgotPassword: (email: string) =>
    http.send('/auth/password/forgot', { ...pub, method: 'POST', body: { email } }),
  resetPassword: (token: string, password: string) =>
    http.send('/auth/password/reset', {
      ...pub,
      method: 'POST',
      body: { token, password },
    }),
};
