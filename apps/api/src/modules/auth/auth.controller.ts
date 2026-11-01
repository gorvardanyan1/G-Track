import type { RequestHandler } from 'express';
import type {
  ChangePasswordRequest,
  DisableTwoFactorRequest,
  LoginRequest,
  TwoFactorCodeRequest,
  TwoFactorEnabledResponse,
  TwoFactorLoginRequest,
  UpdateProfileRequest,
} from '@tempo/shared';
import { UnauthorizedError } from '../../errors/app-error.ts';
import { requestContext } from '../../lib/request-context.ts';
import {
  authenticatedBody,
  clearRefreshCookie,
  readRefreshCookie,
  requireAuth,
  sendLoginOutcome,
  setRefreshCookie,
} from './auth.http.ts';
import { toAuthUser } from './auth.mappers.ts';
import type { AuthService } from './auth.service.ts';

export function createAuthController(auth: AuthService) {
  const login: RequestHandler = async (req, res) => {
    sendLoginOutcome(res, await auth.login(req.body as LoginRequest, requestContext(req)));
  };

  const loginTwoFactor: RequestHandler = async (req, res) => {
    sendLoginOutcome(
      res,
      await auth.loginWithTwoFactor(req.body as TwoFactorLoginRequest, requestContext(req)),
    );
  };

  const refresh: RequestHandler = async (req, res) => {
    const token = readRefreshCookie(req);
    if (!token) throw new UnauthorizedError('No session', 'INVALID_TOKEN');
    try {
      const session = await auth.refresh(token, requestContext(req));
      setRefreshCookie(res, session);
      res.json(authenticatedBody(session));
    } catch (err) {
      if (err instanceof UnauthorizedError) clearRefreshCookie(res);
      throw err;
    }
  };

  const logout: RequestHandler = async (req, res) => {
    await auth.logout(readRefreshCookie(req), requestContext(req));
    clearRefreshCookie(res);
    res.status(204).end();
  };

  const logoutAll: RequestHandler = async (req, res) => {
    await auth.logoutAll(requireAuth(req), requestContext(req));
    clearRefreshCookie(res);
    res.status(204).end();
  };

  const me: RequestHandler = async (req, res) => {
    res.json(toAuthUser(await auth.me(requireAuth(req))));
  };

  const updateProfile: RequestHandler = async (req, res) => {
    const user = await auth.updateProfile(
      requireAuth(req),
      req.body as UpdateProfileRequest,
      requestContext(req),
    );
    res.json(toAuthUser(user));
  };

  const changePassword: RequestHandler = async (req, res) => {
    await auth.changePassword(
      requireAuth(req),
      req.body as ChangePasswordRequest,
      requestContext(req),
    );
    res.status(204).end();
  };

  const startTwoFactorSetup: RequestHandler = async (req, res) => {
    res.json(await auth.startTwoFactorSetup(requireAuth(req)));
  };

  const enableTwoFactor: RequestHandler = async (req, res) => {
    const { code } = req.body as TwoFactorCodeRequest;
    const { recoveryCodes, outcome } = await auth.enableTwoFactor(
      requireAuth(req),
      code,
      requestContext(req),
    );
    const body: TwoFactorEnabledResponse = { recoveryCodes };
    if (outcome?.status === 'authenticated') {
      setRefreshCookie(res, outcome.session);
      body.session = authenticatedBody(outcome.session);
    }
    res.json(body);
  };

  const disableTwoFactor: RequestHandler = async (req, res) => {
    const { password, code } = req.body as DisableTwoFactorRequest;
    await auth.disableTwoFactor(requireAuth(req), password, code, requestContext(req));
    res.status(204).end();
  };

  return {
    login,
    loginTwoFactor,
    refresh,
    logout,
    logoutAll,
    me,
    updateProfile,
    changePassword,
    startTwoFactorSetup,
    enableTwoFactor,
    disableTwoFactor,
  };
}
