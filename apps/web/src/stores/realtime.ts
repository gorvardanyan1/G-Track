import { defineStore } from 'pinia';
import { ref } from 'vue';
import { io, type Socket } from 'socket.io-client';
import {
  REALTIME_ERRORS,
  REALTIME_PATH,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@tempo/shared';
import { http } from '../api/client.ts';

type RealtimeSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type RealtimeStatus = 'offline' | 'connecting' | 'online';

/**
 * The live connection. The server decides rooms from the token; this only connects, keeps the
 * token fresh, and hands events to the stores. Other tabs and devices stay in sync through it.
 */
export const useRealtimeStore = defineStore('realtime', () => {
  const status = ref<RealtimeStatus>('offline');
  let socket: RealtimeSocket | null = null;
  const handlers: [keyof ServerToClientEvents, (...args: never[]) => void][] = [];

  /** Gets a fresh token (refresh), then connects again; gives up if the session is gone. */
  async function reconnectWithFreshToken(): Promise<void> {
    const session = await http.refresh();
    if (session && socket) socket.connect();
    else status.value = 'offline';
  }

  function connect(): void {
    if (socket) return;
    status.value = 'connecting';
    socket = io({
      path: REALTIME_PATH,
      // WebSocket only: its handshake always carries Origin, which the server requires
      // (browsers omit Origin on same-origin polling GETs).
      transports: ['websocket'],
      // Read on every (re)connect, so a refreshed token is always used.
      auth: (cb) => cb({ token: http.getAccessToken() ?? '' }),
      reconnectionDelayMax: 10_000,
    });
    for (const [event, handler] of handlers) socket.on(event, handler as never);
    socket.on('connect', () => {
      status.value = 'online';
    });
    socket.on('disconnect', (reason) => {
      status.value = 'connecting';
      // The server closed it: the token expired (or the session ended).
      if (reason === 'io server disconnect') void reconnectWithFreshToken();
    });
    socket.on('connect_error', (err) => {
      if (err.message === REALTIME_ERRORS.UNAUTHORIZED) void reconnectWithFreshToken();
      else if (socket && !socket.active) status.value = 'offline';
    });
  }

  function disconnect(): void {
    socket?.disconnect();
    socket = null;
    status.value = 'offline';
  }

  /** Subscribes for the app's lifetime (survives reconnects). */
  function on<E extends keyof ServerToClientEvents>(event: E, handler: ServerToClientEvents[E]) {
    handlers.push([event, handler]);
    socket?.on(event, handler as never);
  }

  return { status, connect, disconnect, on };
});
