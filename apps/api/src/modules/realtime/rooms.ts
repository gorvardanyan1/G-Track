import { UserRole } from '@tempo/shared';
import type { RealtimeRepository } from './realtime.repository.ts';

/** Room names. Only the server puts sockets into rooms; clients can't choose them. */
export const Room = {
  /** Every tab/device of one user: own entries, timer and timesheets. */
  user: (userId: string) => `user:${userId}`,
  /** One session family, so logging out closes exactly that session's connections. */
  session: (sessionId: string) => `session:${sessionId}`,
  /** Managers of one project: live activity on it. */
  project: (projectId: string) => `project:${projectId}`,
  /** Super Admins: all live activity. */
  admin: 'admin',
} as const;

export const isWatchRoom = (room: string) => room === Room.admin || room.startsWith('project:');

export interface WatchScope {
  rooms: string[];
  /** Projects whose activity the user may watch; null = all (admin); [] = none. */
  projectIds: string[] | null;
}

/**
 * Which activity rooms a user may be in, from the database (never from the token): Super Admins
 * watch everything; a PM watches projects where they are the PM *and* still hold the PM role;
 * workers watch nothing but their own room.
 */
export async function watchScope(
  realtime: RealtimeRepository,
  user: { id: string; role: UserRole },
): Promise<WatchScope> {
  if (user.role === UserRole.SUPER_ADMIN) return { rooms: [Room.admin], projectIds: null };
  if (user.role !== UserRole.PROJECT_MANAGER) return { rooms: [], projectIds: [] };
  const projectIds = await realtime.managedProjectIds(user.id);
  return { rooms: projectIds.map(Room.project), projectIds };
}
