import type { ClientToServerEvents, ServerToClientEvents } from '@tempo/shared';
import type { Server, Socket } from 'socket.io';
import type { AuthContext } from '../auth/auth.types.ts';

export interface SocketData {
  auth: AuthContext;
  /** When the access token used to connect expires; the connection closes then. */
  expiresAt: Date;
}

export type RealtimeIo = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
export type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;
