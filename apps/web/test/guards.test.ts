import { describe, expect, it } from 'vitest';
import { UserRole } from '@tempo/shared';
import { decide, homeFor, safeRedirect } from '../src/router/guards.ts';
import { navigationFor, rolesFor } from '../src/router/navigation.ts';

const signedIn = (role: UserRole) => ({ status: 'authenticated' as const, role });
const anonymous = { status: 'anonymous' as const, role: null };

describe('route guards', () => {
  it('sends signed-out users to login with the page they wanted', () => {
    expect(decide({}, anonymous, '/week?x=1')).toEqual({
      kind: 'redirect',
      to: '/login',
      query: { redirect: '/week?x=1' },
    });
    expect(decide({}, anonymous, '/')).toEqual({ kind: 'redirect', to: '/login' });
    expect(decide({ public: true }, anonymous, '/reset-password')).toEqual({ kind: 'allow' });
  });

  it('keeps signed-in users away from guest pages', () => {
    expect(decide({ public: true, guestOnly: true }, signedIn(UserRole.WORKER), '/login')).toEqual({
      kind: 'redirect',
      to: '/today',
    });
    expect(
      decide({ public: true, guestOnly: true }, signedIn(UserRole.SUPER_ADMIN), '/login'),
    ).toEqual({ kind: 'redirect', to: '/dashboard' });
  });

  it('shows 404 (not 403) for pages of other roles', () => {
    expect(
      decide({ roles: rolesFor('/settings') }, signedIn(UserRole.WORKER), '/settings'),
    ).toEqual({ kind: 'not-found' });
    expect(
      decide({ roles: rolesFor('/settings') }, signedIn(UserRole.PROJECT_MANAGER), '/settings'),
    ).toEqual({ kind: 'not-found' });
    expect(
      decide({ roles: rolesFor('/settings') }, signedIn(UserRole.SUPER_ADMIN), '/settings'),
    ).toEqual({ kind: 'allow' });
    expect(decide({ roles: rolesFor('/today') }, signedIn(UserRole.SUPER_ADMIN), '/today')).toEqual(
      { kind: 'not-found' },
    );
    expect(decide({}, signedIn(UserRole.WORKER), '/profile')).toEqual({ kind: 'allow' });
  });

  it('only follows same-app redirects', () => {
    expect(safeRedirect('/week')).toBe('/week');
    expect(safeRedirect('//evil.test')).toBeNull();
    expect(safeRedirect('https://evil.test')).toBeNull();
    expect(safeRedirect(['/week'])).toBeNull();
  });

  it('builds the menu per role, consistent with the guards', () => {
    const labels = (role: UserRole) =>
      navigationFor(role).flatMap((s) => s.items.map((i) => i.label));
    expect(labels(UserRole.WORKER)).toEqual(['Today', 'Timesheet', 'Calendar', 'My reports']);
    expect(labels(UserRole.PROJECT_MANAGER)).toEqual([
      'Today',
      'Timesheet',
      'Calendar',
      'My reports',
      'Dashboard',
      'Projects',
      'Approvals',
      'Reports',
    ]);
    expect(labels(UserRole.SUPER_ADMIN)).toEqual([
      'Dashboard',
      'Projects',
      'Approvals',
      'Reports',
      'Users',
      'Clients',
      'Audit log',
      'Settings',
    ]);
    for (const role of [UserRole.WORKER, UserRole.PROJECT_MANAGER, UserRole.SUPER_ADMIN]) {
      for (const item of navigationFor(role).flatMap((s) => s.items)) {
        expect(decide({ roles: rolesFor(item.to) }, signedIn(role), item.to)).toEqual({
          kind: 'allow',
        });
      }
      expect(decide({ roles: rolesFor(homeFor(role)) }, signedIn(role), homeFor(role))).toEqual({
        kind: 'allow',
      });
    }
  });
});
