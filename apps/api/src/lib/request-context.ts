import type { Request } from 'express';

/** Who/where a request came from, for audit rows and session metadata. */
export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

export function requestContext(req: Request): RequestContext {
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 512) ?? null,
    requestId: req.id,
  };
}
