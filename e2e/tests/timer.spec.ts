import { expect, test, type Page } from '@playwright/test';
import { signIn } from '../support/auth.ts';

const bar = (page: Page) => page.getByRole('region', { name: 'Timer' });
const startButton = (page: Page) => bar(page).getByRole('button', { name: /^(Start|Stop) timer/ });
const elapsedSeconds = async (page: Page) => {
  const label =
    (await bar(page)
      .getByLabel(/^Elapsed /)
      .getAttribute('aria-label')) ?? '';
  const [h = 0, m = 0, s = 0] = label.replace('Elapsed ', '').split(':').map(Number);
  return h * 3600 + m * 60 + s;
};

async function startTimer(page: Page, description: string) {
  await bar(page).getByLabel('Description').fill(description);
  await bar(page)
    .getByRole('button', { name: /^Project/ })
    .click();
  await page.getByRole('option').first().click();
  await startButton(page).click();
  await expect(startButton(page)).toHaveAttribute('aria-pressed', 'true');
}

test('a worker starts and stops the timer', async ({ page }) => {
  await signIn(page, 'davit.grigoryan@tempo.test');
  await expect(page).toHaveURL(/\/today$/);
  await startTimer(page, 'E2E: map clustering');

  // The time runs (on the server clock) and the tab title shows it.
  await expect.poll(() => elapsedSeconds(page), { timeout: 5000 }).toBeGreaterThanOrEqual(2);
  await expect(page).toHaveTitle(/^\d{1,2}:\d{2}:\d{2} /);

  await startButton(page).click();
  await expect(startButton(page)).toHaveAttribute('aria-pressed', 'false');
  // The stopped entry is in today's list (descriptions there are editable inputs).
  await expect
    .poll(() =>
      page
        .locator('input[aria-label="Description"]:not([role=region] *)')
        .evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value)),
    )
    .toContain('E2E: map clustering');
});

test('a running timer continues after a page reload', async ({ page }) => {
  await signIn(page, 'ethan.brooks@tempo.test');
  await startTimer(page, 'E2E: survives reload');
  await expect.poll(() => elapsedSeconds(page), { timeout: 5000 }).toBeGreaterThanOrEqual(2);
  const before = await elapsedSeconds(page);

  await page.reload();
  await expect(startButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(bar(page).getByLabel('Description')).toHaveValue('E2E: survives reload');
  // It kept counting from the server's start time, not from zero.
  await expect.poll(() => elapsedSeconds(page)).toBeGreaterThan(before);

  await startButton(page).click();
  await expect(startButton(page)).toHaveAttribute('aria-pressed', 'false');
});
