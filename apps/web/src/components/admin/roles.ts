import type { UserRole } from '@tempo/shared';

export const ROLE_LABEL: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super admin',
  PROJECT_MANAGER: 'Project manager',
  WORKER: 'Worker',
};

export const ROLE_TONE: Record<UserRole, 'accent' | 'success' | 'neutral'> = {
  SUPER_ADMIN: 'accent',
  PROJECT_MANAGER: 'success',
  WORKER: 'neutral',
};

export const ROLE_OPTIONS = [
  { value: 'WORKER', label: 'Worker' },
  { value: 'PROJECT_MANAGER', label: 'Project manager' },
  { value: 'SUPER_ADMIN', label: 'Super admin' },
] as const satisfies readonly { value: UserRole; label: string }[];
