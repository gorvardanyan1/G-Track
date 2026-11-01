import type { Logger } from 'pino';

/** Work that must not delay (or be timed through) the HTTP response, e.g. password-reset mail. */
export interface BackgroundRunner {
  run(name: string, task: () => Promise<void>): void;
}

export function createBackgroundRunner(logger: Logger): BackgroundRunner {
  return {
    run(name, task) {
      task().catch((err: unknown) => logger.error({ err, task: name }, 'background task failed'));
    },
  };
}
