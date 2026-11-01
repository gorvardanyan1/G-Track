import { RealtimeEvent } from '@tempo/shared';
import type { Clock } from '../../lib/clock.ts';
import type { DomainEvent } from '../../lib/event-bus.ts';
import type { EntryPolicy } from '../time-entries/entry-policy.ts';
import { toTimeEntryResponse } from '../time-entries/time-entries.mappers.ts';
import { toActivityEntry } from './activity.ts';
import type { RealtimeRepository } from './realtime.repository.ts';
import type { RealtimeIo } from './realtime.types.ts';
import { isWatchRoom, Room, watchScope } from './rooms.ts';

interface Deps {
  io: RealtimeIo;
  realtime: RealtimeRepository;
  policy: EntryPolicy;
  clock: Clock;
}

/**
 * Turns domain events into socket events. Payloads are loaded fresh from the database, so a
 * late event never carries stale data, and events of one user are handled in order.
 */
export function createRealtimeDispatcher({ io, realtime, policy, clock }: Deps) {
  const serverTime = () => clock().toISOString();
  const queues = new Map<string, Promise<void>>();

  /** Runs `task` after the previous one for the same user (per-user ordering). */
  function serialize(userId: string, task: () => Promise<void>): Promise<void> {
    const next = (queues.get(userId) ?? Promise.resolve()).then(task, task);
    queues.set(userId, next);
    void next.finally(() => {
      if (queues.get(userId) === next) queues.delete(userId);
    });
    return next;
  }

  /** "Working now" for one user, to each room that may see it (none if no project was touched). */
  async function publishActivity(userId: string, projectIds: string[]): Promise<void> {
    if (projectIds.length === 0) return;
    const [user, running] = await Promise.all([
      realtime.findUser(userId),
      realtime.findRunning(userId),
    ]);
    if (!user) return;
    const person = { id: user.id, name: user.name };
    const activity = running && toActivityEntry(running);
    io.to(Room.admin).emit(RealtimeEvent.ACTIVITY_UPDATE, {
      user: person,
      running: activity,
      serverTime: serverTime(),
    });
    // Each project's managers learn whether the user is working on *their* project; the PM of
    // a project the user just left sees `null`, never where they went.
    const projects = new Set([...projectIds, ...(running ? [running.projectId] : [])]);
    for (const projectId of projects) {
      io.to(Room.project(projectId)).emit(RealtimeEvent.ACTIVITY_UPDATE, {
        user: person,
        running: running?.projectId === projectId ? activity : null,
        serverTime: serverTime(),
      });
    }
  }

  async function entrySaved(event: Extract<DomainEvent, { type: 'entry.saved' }>) {
    const [entry, owner] = await Promise.all([
      realtime.findEntry(event.entryId),
      realtime.findUser(event.userId),
    ]);
    // Gone already (e.g. replaced in the same second): its deletion is published separately.
    if (!entry || !owner) return;
    const locked = await policy.lockedEntryIds(owner, [entry]);
    io.to(Room.user(event.userId)).emit(RealtimeEvent.ENTRY_SAVED, {
      action: event.action,
      entry: toTimeEntryResponse(entry, !locked.has(entry.id)),
      serverTime: serverTime(),
    });
    // Manual entries and edits of finished entries don't change who is working right now.
    const touchesTimer =
      event.action !== 'created' && !(event.action === 'updated' && entry.endedAt !== null);
    if (touchesTimer) await publishActivity(event.userId, event.projectIds);
  }

  /** Puts every connection of the user into exactly the rooms they may watch now. */
  async function refreshAccess(userId: string): Promise<void> {
    const user = await realtime.findUser(userId);
    const sockets = await io.in(Room.user(userId)).fetchSockets();
    if (!user?.isActive) {
      for (const socket of sockets) socket.disconnect(true);
      return;
    }
    const scope = await watchScope(realtime, user);
    for (const socket of sockets) {
      for (const room of socket.rooms) if (isWatchRoom(room)) socket.leave(room);
      if (scope.rooms.length > 0) socket.join(scope.rooms);
    }
    if (scope.rooms.length > 0) {
      io.to(Room.user(userId)).emit(
        RealtimeEvent.ACTIVITY_SNAPSHOT,
        await snapshot(scope.projectIds),
      );
    }
  }

  async function snapshot(projectIds: string[] | null) {
    const running = await realtime.runningOn(projectIds);
    return {
      items: running.map((entry) => ({ user: entry.user, entry: toActivityEntry(entry) })),
      serverTime: serverTime(),
    };
  }

  async function handle(event: DomainEvent): Promise<void> {
    switch (event.type) {
      case 'entry.saved':
        return serialize(event.userId, () => entrySaved(event));
      case 'entry.deleted':
        return serialize(event.userId, async () => {
          io.to(Room.user(event.userId)).emit(RealtimeEvent.ENTRY_DELETED, {
            id: event.entryId,
            serverTime: serverTime(),
          });
          await publishActivity(event.userId, event.projectIds);
        });
      case 'timesheet.changed':
        return serialize(event.userId, async () => {
          const sheet = await realtime.findTimesheet(event.timesheetId);
          if (!sheet) return;
          io.to(Room.user(sheet.userId)).emit(RealtimeEvent.TIMESHEET_CHANGED, {
            id: sheet.id,
            weekStart: sheet.weekStart.toISOString().slice(0, 10),
            status: sheet.status,
            serverTime: serverTime(),
          });
        });
      case 'access.changed':
        return serialize(event.userId, () => refreshAccess(event.userId));
      case 'sessions.revoked':
        io.in(
          event.sessionId ? Room.session(event.sessionId) : Room.user(event.userId),
        ).disconnectSockets(true);
        return;
    }
  }

  return { handle, snapshot };
}

export type RealtimeDispatcher = ReturnType<typeof createRealtimeDispatcher>;
