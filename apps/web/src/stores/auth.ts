import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type {
  AcceptInviteRequest,
  AuthenticatedResponse,
  AuthUser,
  LoginResponse,
  UpdateProfileRequest,
  UserRole,
} from '@tempo/shared';
import { authApi } from '../api/auth.ts';
import { http } from '../api/client.ts';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';
export type LoginStep = 'authenticated' | 'two_factor' | 'two_factor_setup';

export const useAuthStore = defineStore('auth', () => {
  const status = ref<AuthStatus>('unknown');
  const user = ref<AuthUser | null>(null);
  /** Between the password step and the 2FA step (memory only). */
  const challengeToken = ref<string | null>(null);
  /** A Super Admin who must enrol in 2FA before the session starts (memory only). */
  const setupToken = ref<string | null>(null);
  let bootstrapping: Promise<void> | null = null;

  function setSession(session: AuthenticatedResponse): void {
    http.setAccessToken(session.accessToken);
    user.value = session.user;
    status.value = 'authenticated';
    challengeToken.value = null;
    setupToken.value = null;
  }

  function clear(): void {
    http.setAccessToken(null);
    user.value = null;
    status.value = 'anonymous';
  }

  function outcome(result: LoginResponse): LoginStep {
    if (result.status === 'authenticated') {
      setSession(result);
      return 'authenticated';
    }
    if (result.status === 'two_factor_required') {
      challengeToken.value = result.challengeToken;
      return 'two_factor';
    }
    setupToken.value = result.setupToken;
    return 'two_factor_setup';
  }

  return {
    status,
    user,
    challengeToken,
    setupToken,
    role: computed<UserRole | null>(() => user.value?.role ?? null),
    setSession,
    clear,

    /** On app start: a refresh cookie may still hold a session (the token is never stored). */
    bootstrap(): Promise<void> {
      if (status.value !== 'unknown') return Promise.resolve();
      bootstrapping ??= http.refresh().then((session) => {
        if (session) setSession(session);
        else clear();
      });
      return bootstrapping;
    },

    async login(email: string, password: string): Promise<LoginStep> {
      return outcome(await authApi.login({ email, password }));
    },

    async verifyTwoFactor(input: { code: string } | { recoveryCode: string }): Promise<void> {
      if (!challengeToken.value) throw new Error('No sign-in in progress');
      setSession(await authApi.loginTwoFactor({ challengeToken: challengeToken.value, ...input }));
    },

    startForcedSetup() {
      if (!setupToken.value) throw new Error('No 2FA setup in progress');
      return authApi.startTwoFactorSetup(setupToken.value);
    },

    /** Finishes forced enrolment: returns the recovery codes; the session starts. */
    async completeForcedSetup(code: string): Promise<string[]> {
      if (!setupToken.value) throw new Error('No 2FA setup in progress');
      const result = await authApi.enableTwoFactor(code, setupToken.value);
      if (result.session) setSession(result.session);
      return result.recoveryCodes;
    },

    async acceptInvite(input: AcceptInviteRequest): Promise<LoginStep> {
      return outcome(await authApi.acceptInvite(input));
    },

    async logout(): Promise<void> {
      await authApi.logout().catch(() => undefined);
      clear();
    },

    async updateProfile(input: UpdateProfileRequest): Promise<void> {
      user.value = await authApi.updateProfile(input);
    },

    /** After enabling/disabling 2FA from the profile. */
    async reload(): Promise<void> {
      user.value = await authApi.me();
    },
  };
});
