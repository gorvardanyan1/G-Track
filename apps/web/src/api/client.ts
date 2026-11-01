import {
  apiErrorResponseSchema,
  authenticatedResponseSchema,
  ErrorCode,
  parseServerTimeHeader,
  SERVER_TIME_HEADER,
  type AuthenticatedResponse,
  type ClockSample,
} from '@tempo/shared';
import type { z } from 'zod';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** JSON body. */
  body?: unknown;
  query?: Record<string, string | number | boolean | readonly string[] | undefined>;
  /** false: send no access token and never try to refresh (login, reset password, …). */
  auth?: boolean;
  /** Use this bearer token instead of the session's (the 2FA setup token). */
  token?: string;
  signal?: AbortSignal;
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Device clock, for server-offset samples. */
  now?: () => number;
  /** Serializes refreshes across tabs, so two tabs never rotate the same cookie at once. */
  lock?: <T>(name: string, task: () => Promise<T>) => Promise<T>;
  /** Waits before retrying a refresh another tab is doing. */
  sleep?: (ms: number) => Promise<void>;
}

type Listener<T> = (value: T) => void;

/** Only these 401s mean "the access token is stale"; others (wrong password) are final. */
const REFRESHABLE = new Set<string>([ErrorCode.UNAUTHORIZED, ErrorCode.INVALID_TOKEN]);

function webLock<T>(name: string, task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks ? locks.request(name, task) : task();
}

/**
 * The only way the web app talks to the api. The access token lives in memory only; the refresh
 * token is an httpOnly cookie the browser sends to /auth. A stale token is refreshed once
 * (single flight) and the request retried. Every response's X-Server-Time feeds the clock store.
 */
export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const now = options.now ?? (() => Date.now());
  const lock = options.lock ?? webLock;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let accessToken: string | null = null;
  let refreshing: Promise<AuthenticatedResponse | null> | null = null;
  const serverTimeListeners = new Set<Listener<ClockSample>>();
  const sessionListeners = new Set<Listener<AuthenticatedResponse>>();
  const expiredListeners = new Set<Listener<void>>();

  function url(path: string, query?: RequestOptions['query']): string {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) search.append(key, String(v));
    }
    const qs = search.toString();
    return `${options.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  }

  async function send(path: string, opts: RequestOptions, token: string | null) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const requestStart = now();
    const response = await doFetch(url(path, opts.query), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? null : JSON.stringify(opts.body),
      credentials: 'include',
      signal: opts.signal ?? null,
    });
    const serverTime = parseServerTimeHeader(response.headers.get(SERVER_TIME_HEADER));
    if (serverTime !== null) {
      const sample = { requestStart, responseEnd: now(), serverTime };
      for (const listener of serverTimeListeners) listener(sample);
    }
    return response;
  }

  async function errorOf(response: Response): Promise<ApiError> {
    const body: unknown = await response.json().catch(() => undefined);
    const parsed = apiErrorResponseSchema.safeParse(body);
    if (parsed.success) {
      const { code, message, details } = parsed.data.error;
      return new ApiError(response.status, code, message, details);
    }
    return new ApiError(
      response.status,
      ErrorCode.INTERNAL_ERROR,
      `Request failed (${response.status})`,
    );
  }

  async function refreshOnce(): Promise<AuthenticatedResponse | null> {
    // Another tab may be rotating the cookie right now (409): wait and try again.
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await send('/auth/refresh', { method: 'POST' }, null);
      if (response.status === 409) {
        await sleep(250 * (attempt + 1));
        continue;
      }
      if (!response.ok) return null;
      const parsed = authenticatedResponseSchema.safeParse(await response.json().catch(() => null));
      if (!parsed.success) return null;
      accessToken = parsed.data.accessToken;
      for (const listener of sessionListeners) listener(parsed.data);
      return parsed.data;
    }
    return null;
  }

  /** Exchanges the refresh cookie for a new session; concurrent callers share one request. */
  function refresh(): Promise<AuthenticatedResponse | null> {
    refreshing ??= lock('tempo-refresh', refreshOnce)
      .catch(() => null)
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  async function execute(path: string, opts: RequestOptions): Promise<Response> {
    const useSession = opts.auth !== false && opts.token === undefined;
    if (useSession && accessToken === null) await refresh();
    const tokenUsed = opts.token ?? (useSession ? accessToken : null);
    let response = await send(path, opts, tokenUsed);

    if (response.status === 401 && useSession) {
      const error = await errorOf(response.clone());
      if (REFRESHABLE.has(error.code)) {
        // Someone else may have refreshed while this request was in flight.
        const fresh = accessToken !== tokenUsed ? accessToken : (await refresh())?.accessToken;
        if (fresh) response = await send(path, opts, fresh);
        if (response.status === 401) {
          accessToken = null;
          for (const listener of expiredListeners) listener();
        }
      }
    }
    if (!response.ok) throw await errorOf(response);
    return response;
  }

  return {
    /** A request whose JSON response is validated with `schema`. */
    async request<S extends z.ZodType>(
      path: string,
      schema: S,
      opts: RequestOptions = {},
    ): Promise<z.infer<S>> {
      const response = await execute(path, opts);
      const parsed = schema.safeParse(await response.json().catch(() => undefined));
      if (!parsed.success) {
        throw new ApiError(response.status, 'INVALID_RESPONSE', 'Unexpected response from server');
      }
      return parsed.data;
    },

    /** A request without a response body (204). */
    async send(path: string, opts: RequestOptions = {}): Promise<void> {
      await execute(path, opts);
    },

    /** A file download (exports): the body plus the server's filename. */
    async download(path: string, opts: RequestOptions = {}) {
      const response = await execute(path, opts);
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? 'download';
      return { blob: await response.blob(), filename };
    },

    refresh,
    getAccessToken: () => accessToken,
    setAccessToken: (token: string | null) => {
      accessToken = token;
    },
    onServerTime: (listener: Listener<ClockSample>) => {
      serverTimeListeners.add(listener);
      return () => serverTimeListeners.delete(listener);
    },
    /** A refresh produced a new session (fresh token and user). */
    onSession: (listener: Listener<AuthenticatedResponse>) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    /** The session ended (refresh failed): sign the user out. */
    onSessionExpired: (listener: Listener<void>) => {
      expiredListeners.add(listener);
      return () => expiredListeners.delete(listener);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

export const http: ApiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
});
