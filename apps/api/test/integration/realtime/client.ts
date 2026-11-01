import { REALTIME_PATH } from '@tempo/shared';
import { io, type Socket } from 'socket.io-client';
import { ORIGIN } from '../auth/harness.ts';

export interface Received {
  event: string;
  payload: Record<string, unknown>;
}

/** A socket that records every event from the first moment, plus helpers to wait on them. */
export interface TestClient {
  socket: Socket;
  received: Received[];
  /** Resolves with the first matching event (already received, or arriving within 3 s). */
  next<T = Record<string, unknown>>(event: string, match?: (payload: T) => boolean): Promise<T>;
  /** All payloads of an event received so far. */
  all<T = Record<string, unknown>>(event: string): T[];
  /** Resolves when the server closes the connection. */
  disconnected(): Promise<string>;
}

export function connect(
  url: string,
  token: string | undefined,
  origin = ORIGIN,
): Promise<TestClient> {
  const socket = io(url, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    auth: token === undefined ? {} : { token },
    extraHeaders: { origin },
    reconnection: false,
    forceNew: true,
    autoConnect: false,
  });
  const received: Received[] = [];
  const waiters = new Set<() => void>();
  socket.onAny((event: string, payload: Record<string, unknown>) => {
    received.push({ event, payload });
    for (const wake of waiters) wake();
  });
  let closeReason: string | null = null;
  const closeWaiters: ((reason: string) => void)[] = [];
  socket.on('disconnect', (reason) => {
    closeReason = reason;
    for (const resolve of closeWaiters.splice(0)) resolve(reason);
  });

  const client: TestClient = {
    socket,
    received,
    next<T>(event: string, match: (payload: T) => boolean = () => true): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const check = () => {
          const found = received.find((r) => r.event === event && match(r.payload as T));
          if (!found) return false;
          waiters.delete(wake);
          clearTimeout(timer);
          resolve(found.payload as T);
          return true;
        };
        const wake = () => void check();
        const timer = setTimeout(() => {
          waiters.delete(wake);
          reject(
            new Error(`no "${event}" event; got ${JSON.stringify(received.map((r) => r.event))}`),
          );
        }, 3000);
        if (!check()) waiters.add(wake);
      });
    },
    all: <T>(event: string) => received.filter((r) => r.event === event).map((r) => r.payload as T),
    disconnected: () =>
      closeReason !== null
        ? Promise.resolve(closeReason)
        : new Promise((resolve) => closeWaiters.push(resolve)),
  };

  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(client));
    socket.once('connect_error', (err) => {
      socket.close();
      reject(err);
    });
    socket.connect();
  });
}

/** The connect_error message, or "connected" if the connection was (wrongly) accepted. */
export async function connectError(url: string, token?: string, origin?: string): Promise<string> {
  try {
    const client = await connect(url, token, origin);
    client.socket.close();
    return 'connected';
  } catch (err) {
    return (err as Error).message;
  }
}

/** Lets in-flight events arrive before asserting that something did NOT happen. */
export const settle = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms));
