import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Clock } from './clock.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

/** Development transport: each mail becomes a JSON file in the outbox (never written to logs). */
export function createFileMailer(directory: string, from: string, clock: Clock): Mailer {
  return {
    async send(message) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const sentAt = clock().toISOString();
      const file = join(directory, `${sentAt.replace(/[:.]/g, '-')}-${message.to}.json`);
      await writeFile(file, JSON.stringify({ from, sentAt, ...message }, null, 2), { mode: 0o600 });
    },
  };
}

/** Test transport: keeps messages in memory. */
export function createMemoryMailer(): Mailer & { messages: MailMessage[] } {
  const messages: MailMessage[] = [];
  return {
    messages,
    send(message) {
      messages.push(message);
      return Promise.resolve();
    },
  };
}
