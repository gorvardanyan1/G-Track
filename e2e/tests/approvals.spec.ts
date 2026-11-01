import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth.ts';

test('a worker submits last week and each project’s PM approves their part', async ({
  browser,
}) => {
  const worker = await browser.newPage();
  await signIn(worker, 'jonas.weber@tempo.test');
  await worker.goto('/week');
  await worker.getByRole('button', { name: 'Previous week' }).click();
  await worker.getByRole('button', { name: 'Submit week' }).click();
  await worker.getByRole('dialog').getByRole('button', { name: 'Submit' }).click();
  await expect(worker.getByText('Submitted', { exact: true })).toBeVisible();
  await expect(worker.getByRole('button', { name: 'Submit week' })).toBeHidden();

  const pm = await browser.newPage();
  await signIn(pm, 'petra.neumann@tempo.test');
  await pm.goto('/approvals');
  const row = pm.getByRole('row', { name: /Jonas Weber/ });
  await row.getByRole('button', { name: 'Review' }).click();
  const dialog = pm.getByRole('dialog');
  // Petra sees her own project by name; Jonas's other project is only a total.
  await expect(dialog.getByText('Fleet Dashboard').first()).toBeVisible();
  await expect(dialog.getByText('Patient Portal')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Approve' }).click();
  await expect(dialog).toBeHidden();
  await expect(pm.getByRole('row', { name: /Jonas Weber/ })).toHaveCount(0);
  // Jonas also worked on Marcus's Patient Portal: the week waits for Marcus's part too.
  await expect(worker.getByText('Submitted', { exact: true })).toBeVisible();

  const otherPm = await browser.newPage();
  await signIn(otherPm, 'marcus.reed@tempo.test');
  await otherPm.goto('/approvals');
  await otherPm
    .getByRole('row', { name: /Jonas Weber/ })
    .getByRole('button', { name: 'Review' })
    .click();
  await otherPm.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
  await expect(otherPm.getByRole('dialog')).toBeHidden();

  // The worker's open tab learns about it live.
  await expect(worker.getByText('Approved', { exact: true }).first()).toBeVisible();
});
