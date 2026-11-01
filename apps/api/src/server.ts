import { createApi } from './app.ts';
import { EnvValidationError, parseEnv } from './config/env.ts';
import { createPrismaClient } from './db/prisma.ts';
import { systemClock } from './lib/clock.ts';
import { createEventBus } from './lib/event-bus.ts';
import { createJobs } from './jobs.ts';
import { createLogger } from './lib/logger.ts';
import { createFileMailer } from './lib/mailer.ts';

function loadEnv() {
  try {
    return parseEnv(process.env);
  } catch (err) {
    if (err instanceof EnvValidationError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

const env = loadEnv();
const logger = createLogger(env);
const prisma = createPrismaClient(env.DATABASE_URL);
// Development transport only; a real SMTP/API mailer replaces this before production.
const mailer = createFileMailer(env.MAIL_OUTBOX_DIR, env.MAIL_FROM, systemClock);
if (env.NODE_ENV === 'production') {
  // Invite and reset links are secrets: in production they must not sit in files for long.
  logger.warn(
    { outbox: env.MAIL_OUTBOX_DIR },
    'mail is written to the outbox directory; connect a mail relay before inviting real users',
  );
}
// One bus for requests and jobs, so e.g. auto-stopped timers reach open tabs.
// In-process: with several api instances this needs a shared adapter (e.g. Redis).
const events = createEventBus(logger);
const { app, attachRealtime } = createApi({ env, logger, prisma, mailer, events });

const stopAutoStop = createJobs({ prisma, logger, clock: systemClock, events }).autoStop.schedule();

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info({ host: env.HOST, port: env.PORT, nodeEnv: env.NODE_ENV }, 'api listening');
});
const realtime = attachRealtime(server);

function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, 'shutting down');
  stopAutoStop();
  // Disconnects sockets, then closes the HTTP server.
  realtime
    .close()
    .then(() => 0)
    .catch((err: unknown) => {
      logger.error({ err }, 'error while closing server');
      return 1;
    })
    .then((code) => prisma.$disconnect().finally(() => process.exit(code)))
    .catch(() => process.exit(1));
  // Don't hang forever on keep-alive connections.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
