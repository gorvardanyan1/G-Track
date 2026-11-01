import { UserRole } from '@tempo/shared';
import type { AuthStatus } from '../stores/auth.ts';

export interface RouteAccess {
  /** Reachable without signing in. */
  public?: boolean;
  /** Only for signed-out users (login, reset password …); signed-in users go home. */
  guestOnly?: boolean;
  /** Roles that may open the page; everyone signed in if omitted. */
  roles?: readonly UserRole[];
}

export type GuardDecision =
  | { kind: 'allow' }
  | { kind: 'redirect'; to: string; query?: Record<string, string> }
  | { kind: 'not-found' };

/** Where each role lands after signing in. */
export function homeFor(role: UserRole): string {
  return role === UserRole.SUPER_ADMIN ? '/dashboard' : '/today';
}

/**
 * UX only: the api enforces every permission. Pages for other roles look like any unknown
 * page (404), the same answer the api gives.
 */
export function decide(
  access: RouteAccess,
  auth: { status: AuthStatus; role: UserRole | null },
  fullPath: string,
): GuardDecision {
  const signedIn = auth.status === 'authenticated' && auth.role !== null;
  if (access.guestOnly && signedIn) return { kind: 'redirect', to: homeFor(auth.role as UserRole) };
  if (access.public) return { kind: 'allow' };
  if (!signedIn) {
    return fullPath === '/' || fullPath === ''
      ? { kind: 'redirect', to: '/login' }
      : { kind: 'redirect', to: '/login', query: { redirect: fullPath } };
  }
  if (access.roles && !access.roles.includes(auth.role as UserRole)) return { kind: 'not-found' };
  return { kind: 'allow' };
}

/** Only same-app paths are followed after login (no open redirects). */
export function safeRedirect(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : null;
}
