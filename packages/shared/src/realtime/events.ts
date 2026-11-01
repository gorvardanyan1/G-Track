import { z } from 'zod';
import { API_PREFIX } from '../http.ts';
import { timeEntryResponseSchema } from '../time-entries/schemas.ts';
import { TIMESHEET_STATUSES } from '../timesheets/schemas.ts';

/** Socket.io endpoint path, under the api prefix so the same proxy rule covers it. */
export const REALTIME_PATH = `${API_PREFIX}/socket.io`;

/**
 * Server → client events. Clients never choose rooms: the server puts each connection in its
 * user's room, and PMs/admins in the rooms they may watch. Clients send no events.
 */
export const RealtimeEvent = {
  /** An own entry was created/changed (any tab or device); a running entry is the timer. */
  ENTRY_SAVED: 'entry:saved',
  ENTRY_DELETED: 'entry:deleted',
  /** An own timesheet changed status (submitted elsewhere, approved, rejected). */
  TIMESHEET_CHANGED: 'timesheet:changed',
  /** PMs and admins: who is tracking right now, sent on connect and when access changes. */
  ACTIVITY_SNAPSHOT: 'activity:snapshot',
  /** PMs and admins: one person started, switched or stopped tracking. */
  ACTIVITY_UPDATE: 'activity:update',
  /** Sent right before the server disconnects an expired token; reconnect with a fresh one. */
  AUTH_EXPIRED: 'auth:expired',
} as const;

export const ENTRY_SAVED_ACTIONS = [
  'created',
  'updated',
  'timer_started',
  'timer_stopped',
  'auto_stopped',
] as const;
export type EntrySavedAction = (typeof ENTRY_SAVED_ACTIONS)[number];

const serverTime = z.iso.datetime();
const person = z.object({ id: z.uuid(), name: z.string() });

export const entrySavedEventSchema = z.object({
  action: z.enum(ENTRY_SAVED_ACTIONS),
  entry: timeEntryResponseSchema,
  serverTime,
});

export const entryDeletedEventSchema = z.object({ id: z.uuid(), serverTime });

export const timesheetChangedEventSchema = z.object({
  id: z.uuid(),
  weekStart: z.iso.date(),
  status: z.enum(TIMESHEET_STATUSES),
  serverTime,
});

/** A running timer as a PM or admin sees it (no rates). */
export const activityEntrySchema = z.object({
  id: z.uuid(),
  project: z.object({ id: z.uuid(), name: z.string(), color: z.string() }),
  task: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  description: z.string(),
  isBillable: z.boolean(),
  startedAt: z.iso.datetime(),
});

export const activitySnapshotEventSchema = z.object({
  items: z.array(z.object({ user: person, entry: activityEntrySchema })),
  serverTime,
});

/** `running: null` = stopped, or now tracking on a project this viewer can't see. */
export const activityUpdateEventSchema = z.object({
  user: person,
  running: activityEntrySchema.nullable(),
  serverTime,
});

export const authExpiredEventSchema = z.object({ serverTime });

export type EntrySavedEvent = z.infer<typeof entrySavedEventSchema>;
export type EntryDeletedEvent = z.infer<typeof entryDeletedEventSchema>;
export type TimesheetChangedEvent = z.infer<typeof timesheetChangedEventSchema>;
export type ActivityEntry = z.infer<typeof activityEntrySchema>;
export type ActivitySnapshotEvent = z.infer<typeof activitySnapshotEventSchema>;
export type ActivityUpdateEvent = z.infer<typeof activityUpdateEventSchema>;
export type AuthExpiredEvent = z.infer<typeof authExpiredEventSchema>;

/** Typed Socket.io event maps for the server and the web client. */
export interface ServerToClientEvents {
  'entry:saved': (event: EntrySavedEvent) => void;
  'entry:deleted': (event: EntryDeletedEvent) => void;
  'timesheet:changed': (event: TimesheetChangedEvent) => void;
  'activity:snapshot': (event: ActivitySnapshotEvent) => void;
  'activity:update': (event: ActivityUpdateEvent) => void;
  'auth:expired': (event: AuthExpiredEvent) => void;
}
export type ClientToServerEvents = Record<string, never>;

/** connect_error messages the server uses. */
export const REALTIME_ERRORS = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  TWO_FACTOR_REQUIRED: 'TWO_FACTOR_REQUIRED',
  ORIGIN_NOT_ALLOWED: 'ORIGIN_NOT_ALLOWED',
  TOO_MANY_CONNECTIONS: 'TOO_MANY_CONNECTIONS',
} as const;
