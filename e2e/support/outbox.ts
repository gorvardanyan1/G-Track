import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect } from '@playwright/test';
import { E2E } from './env.ts';

interface Mail {
  to: string;
  subject: string;
  text: string;
}

/** The newest mail to `to` in the dev outbox (the api writes mails there in background). */
export async function latestMailTo(to: string): Promise<Mail> {
  let found: Mail | undefined;
  await expect
    .poll(
      async () => {
        const files = (await readdir(E2E.outboxDir).catch(() => [])).filter((f) =>
          f.endsWith(`-${to}.json`),
        );
        const newest = files.sort().at(-1);
        found = newest
          ? (JSON.parse(await readFile(join(E2E.outboxDir, newest), 'utf8')) as Mail)
          : undefined;
        return found !== undefined;
      },
      { message: `waiting for a mail to ${to}` },
    )
    .toBe(true);
  return found!;
}

/** The first link in a mail's text. */
export const linkIn = (mail: Mail) => {
  const match = /https?:\/\/\S+/.exec(mail.text);
  if (!match) throw new Error(`no link in mail "${mail.subject}"`);
  return match[0];
};
