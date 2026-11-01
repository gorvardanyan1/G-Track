import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth.ts';

test('a worker submits last week and their PM approves it', async ({ browser }) => {
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
  await expect(dialog.getByText('Fleet Dashboard')).toBeVisible();
  await expect(dialog.getByText('Patient Portal')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Approve' }).click();
  await expect(dialog).toBeHidden();
  await expect(pm.getByRole('row', { name: /Jonas Weber/ })).toHaveCount(0);

  // The worker's open tab learns about it live.
  await expect(worker.getByText('Approved', { exact: true }).first()).toBeVisible();
});
