import type { RequestHandler } from 'express';
import type { HealthResponse } from '@tempo/shared';

export const getHealth: RequestHandler = (_req, res) => {
  const body: HealthResponse = {
    status: 'ok',
    serverTime: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime() * 1000) / 1000,
  };
  res.json(body);
};
