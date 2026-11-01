import type { Server as HttpServer } from 'node:http';
import type { Logger } from 'pino';
import { Server } from 'socket.io';
import { REALTIME_ERRORS, REALTIME_PATH, RealtimeEvent } from '@tempo/shared';
import type { PrismaClient } from '../../db/prisma.ts';
import { AppError } from '../../errors/app-error.ts';
import type { Clock } from '../../lib/clock.ts';
import type { EventBus } from '../../lib/event-bus.ts';
import type { SessionService } from '../auth/session.service.ts';
import { createSettingsRepository } from '../settings/settings.repository.ts';
import { createEntryPolicy } from '../time-entries/entry-policy.ts';
import { createTimeEntriesRepository } from '../time-entries/time-entries.repository.ts';
import { createRealtimeDispatcher } from './realtime.dispatcher.ts';
import { createRealtimeRepository } from './realtime.repository.ts';
import type { RealtimeIo, RealtimeSocket } from './realtime.types.ts';
import { Room, watchScope } from './rooms.ts';

export interface RealtimeDeps {
  prisma: PrismaClient;
  sessions: SessionService;
  events: EventBus;
  clock: Clock;
  logger: Logger;
  allowedOrigins: readonly string[];
  /** Per user, across all tabs and devices. */
  maxConnectionsPerUser?: number;
}

/** Errors a client sees as `connect_error` with `err.message` set to one of REALTIME_ERRORS. */
const rejection = (message: string) => new Error(message);

/**
 * Socket.io on the api's HTTP server. Connections authenticate with the access token in the
 * handshake (`auth: { token }`), from an allowed Origin. The server alone decides rooms:
 * own user room + session room for everyone, project rooms for PMs, the admin room for admins.
 */
export function attachRealtime(httpServer: HttpServer, deps: RealtimeDeps) {
  const { prisma, sessions, events, clock, logger } = deps;
  const allowed = new Set(deps.allowedOrigins);
  const maxConnections = deps.maxConnectionsPerUser ?? 20;

  const io: RealtimeIo = new Server(httpServer, {
    path: REALTIME_PATH,
    serveClient: false,
    // Clients send nothing but the handshake.
    maxHttpBufferSize: 4096,
    cors: { origin: [...allowed], credentials: false },
    // Refuse other origins before any upgrade (cross-site WebSocket hijacking).
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      callback(null, origin !== undefined && allowed.has(origin));
    },
  });

  const realtime = createRealtimeRepository(prisma);
  const policy = createEntryPolicy({
    entries: createTimeEntriesRepository(prisma),
    settings: createSettingsRepository(prisma),
    clock,
  });
  const dispatcher = createRealtimeDispatcher({ io, realtime, policy, clock });
  const unsubscribe = events.subscribe((event) => dispatcher.handle(event));

  io.use((socket, next) => {
    const token: unknown = (socket.handshake.auth as { token?: unknown }).token;
    if (typeof token !== 'string' || token.length === 0) {
      next(rejection(REALTIME_ERRORS.UNAUTHORIZED));
      return;
    }
    sessions
      .authenticateAccessTokenWithExpiry(token)
      .then(async ({ auth, expiresAt }) => {
        const open = await io.in(Room.user(auth.userId)).fetchSockets();
        if (open.length >= maxConnections) {
          next(rejection(REALTIME_ERRORS.TOO_MANY_CONNECTIONS));
          return;
        }
        socket.data = { auth, expiresAt };
        next();
      })
      .catch((err: unknown) => {
        const code =
          err instanceof AppError && err.code === 'TWO_FACTOR_REQUIRED'
            ? REALTIME_ERRORS.TWO_FACTOR_REQUIRED
            : REALTIME_ERRORS.UNAUTHORIZED;
        next(rejection(code));
      });
  });

  async function onConnection(socket: RealtimeSocket): Promise<void> {
    const { auth, expiresAt } = socket.data;
    // Close the connection when its token expires; the client reconnects with a fresh one.
    const expiry = setTimeout(
      () => {
        socket.emit(RealtimeEvent.AUTH_EXPIRED, { serverTime: clock().toISOString() });
        socket.disconnect(true);
      },
      Math.max(0, expiresAt.getTime() - clock().getTime()),
    );
    socket.on('disconnect', () => clearTimeout(expiry));

    const rooms = [Room.user(auth.userId)];
    if (auth.sessionId) rooms.push(Room.session(auth.sessionId));
    // Role and memberships come from the database at connect time, not from the token.
    const scope = await watchScope(realtime, { id: auth.userId, role: auth.role });
    await socket.join([...rooms, ...scope.rooms]);
    if (scope.rooms.length > 0) {
      socket.emit(RealtimeEvent.ACTIVITY_SNAPSHOT, await dispatcher.snapshot(scope.projectIds));
    }
  }

  io.on('connection', (socket) => {
    onConnection(socket).catch((err: unknown) => {
      logger.error({ err }, 'realtime connection setup failed');
      socket.disconnect(true);
    });
  });

  return {
    io,
    /** Disconnects every client and stops listening to domain events. */
    async close(): Promise<void> {
      unsubscribe();
      await io.close();
    },
  };
}

export type Realtime = ReturnType<typeof attachRealtime>;
