import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { REQUEST_ID_HEADER } from '@tempo/shared';

// Accept an upstream id (e.g. from a proxy) only if it is short and log-safe.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function requestId(): RequestHandler {
  return (req, res, next) => {
    const incoming = req.get(REQUEST_ID_HEADER);
    req.id = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, req.id);
    next();
  };
}
