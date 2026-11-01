import { UserRole } from '@tempo/shared';
import type { IconName } from '../components/ui/icons.ts';

export interface NavItem {
  label: string;
  to: string;
  icon: IconName;
  roles: readonly UserRole[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

const TRACKERS = [UserRole.WORKER, UserRole.PROJECT_MANAGER] as const;
const MANAGERS = [UserRole.PROJECT_MANAGER, UserRole.SUPER_ADMIN] as const;
const ADMINS = [UserRole.SUPER_ADMIN] as const;

export const NAVIGATION: NavSection[] = [
  {
    title: 'Track',
    items: [
      { label: 'Today', to: '/today', icon: 'clock', roles: TRACKERS },
      { label: 'Timesheet', to: '/week', icon: 'grid', roles: TRACKERS },
      { label: 'Calendar', to: '/calendar', icon: 'calendar', roles: TRACKERS },
      { label: 'My reports', to: '/my-reports', icon: 'chart', roles: TRACKERS },
    ],
  },
  {
    title: 'Manage',
    items: [
      { label: 'Dashboard', to: '/dashboard', icon: 'home', roles: MANAGERS },
      { label: 'Projects', to: '/projects', icon: 'folder', roles: MANAGERS },
      { label: 'Approvals', to: '/approvals', icon: 'check-circle', roles: MANAGERS },
      { label: 'Reports', to: '/reports', icon: 'chart', roles: MANAGERS },
    ],
  },
  {
    title: 'Admin',
    items: [
      { label: 'Users', to: '/users', icon: 'users', roles: ADMINS },
      { label: 'Clients', to: '/clients', icon: 'briefcase', roles: ADMINS },
      { label: 'Audit log', to: '/audit-log', icon: 'shield', roles: ADMINS },
      { label: 'Settings', to: '/settings', icon: 'settings', roles: ADMINS },
    ],
  },
];

/** The menu for a role: only sections with at least one item. */
export function navigationFor(role: UserRole): NavSection[] {
  return NAVIGATION.map((section) => ({
    ...section,
    items: section.items.filter((item) => item.roles.includes(role)),
  })).filter((section) => section.items.length > 0);
}

/** Roles of a menu path, used by the router so the menu and the guards never disagree. */
export function rolesFor(path: string): readonly UserRole[] | undefined {
  return NAVIGATION.flatMap((s) => s.items).find((item) => item.to === path)?.roles;
}

export const tracksTime = (role: UserRole | null) =>
  role !== null && (TRACKERS as readonly UserRole[]).includes(role);
