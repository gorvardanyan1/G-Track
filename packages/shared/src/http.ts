export const API_PREFIX = '/api/v1';

/** UTC epoch milliseconds at the moment the server sent the response. */
export const SERVER_TIME_HEADER = 'X-Server-Time';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/** httpOnly refresh-token cookie, scoped to the auth routes only. */
export const REFRESH_COOKIE_NAME = 'tempo_rt';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';
