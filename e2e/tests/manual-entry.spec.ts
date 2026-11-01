import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../support/auth.ts';
import { localDate } from '../support/dates.ts';

/** Lena (Berlin) never works before 08:00 in the seed, so early mornings are free. */
const day = localDate('Europe/Berlin', -2);

async function addEntry(page: Page, description: string, start: string, end: string) {
  await page.getByRole('button', { name: /Add entry/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Project/ }).click();
  await page
    .getByRole('option', { name: /Fleet Dashboard/ })
    .first()
    .click();
  await dialog.getByLabel('Description').fill(description);
  await dialog.getByLabel('Date').fill(day);
  await dialog.getByLabel('Start').fill(start);
  await dialog.getByLabel('End').fill(end);
  await dialog.getByRole('button', { name: 'Add entry' }).click();
  return dialog;
}

test('a manual entry that overlaps another is refused with a clear error', async ({ page }) => {
  await signIn(page, 'lena.fischer@tempo.test');
  await expect(page).toHaveURL(/\/today$/);

  const first = await addEntry(page, 'E2E: early sync', '05:00', '05:45');
  await expect(first).toBeHidden();

  const second = await addEntry(page, 'E2E: overlapping', '05:30', '06:15');
  await expect(second.getByRole('alert')).toContainText('Entries can’t overlap');
  // Nothing was saved; fixing the times works.
  await second.getByLabel('Start').fill('05:45');
  await second.getByRole('button', { name: 'Add entry' }).click();
  await expect(second).toBeHidden();
});
