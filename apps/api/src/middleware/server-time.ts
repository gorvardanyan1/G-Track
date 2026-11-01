import type { RequestHandler, Response } from 'express';
import { SERVER_TIME_HEADER } from '@tempo/shared';

/**
 * Adds X-Server-Time (UTC epoch ms) to every response, stamped as late as possible —
 * right before headers are written — so clients can estimate their clock offset accurately.
 */
export function serverTime(): RequestHandler {
  return (_req, res, next) => {
    const writeHead = res.writeHead.bind(res);
    res.writeHead = ((...args: Parameters<Response['writeHead']>) => {
      res.setHeader(SERVER_TIME_HEADER, String(Date.now()));
      return writeHead(...args);
    }) as Response['writeHead'];
    next();
  };
}
