import { expect, test } from '@playwright/test';
import { signIn } from '../support/auth.ts';
import { latestMailTo, linkIn } from '../support/outbox.ts';
import { totp } from '../support/totp.ts';

test('a super admin invites someone who accepts and signs in', async ({ browser }) => {
  const admin = await browser.newPage();
  await signIn(admin, 'admin@tempo.test');
  // Super admins must enrol 2FA on first sign-in.
  await expect(admin).toHaveURL(/\/login\/2fa-setup/);
  const otpauth = await admin.locator('a[href^="otpauth://"]').getAttribute('href');
  const secret = new URL(otpauth ?? '').searchParams.get('secret') ?? '';
  await admin.getByLabel('Digit 1').fill(totp(secret));
  await admin.getByRole('button', { name: /saved them/ }).click();
  await expect(admin).toHaveURL(/\/dashboard$/);

  const email = `e2e.${Date.now()}@tempo.test`;
  await admin.goto('/users');
  await admin.getByRole('button', { name: 'Invite' }).click();
  const dialog = admin.getByRole('dialog');
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(dialog).toBeHidden();
  await expect(
    admin.locator('section', { hasText: 'Pending invitations' }).getByText(email),
  ).toBeVisible();

  // The invitee opens the link from the email in their own browser.
  const link = linkIn(await latestMailTo(email));
  const inviteeContext = await browser.newContext();
  const invitee = await inviteeContext.newPage();
  await invitee.goto(link);
  await expect(invitee.getByText(email)).toBeVisible();
  await invitee.getByLabel('Your name').fill('Nare Hakobyan');
  const password = 'copper kite over sevan lake';
  await invitee.getByLabel('Password', { exact: true }).fill(password);
  await invitee.getByRole('button', { name: 'Create account' }).click();
  await expect(invitee).toHaveURL(/\/today$/);

  // A fresh sign-in with the chosen password works too.
  await inviteeContext.clearCookies();
  await signIn(invitee, email, password);
  await expect(invitee).toHaveURL(/\/today$/);

  // The admin's list now has the new person, and the invite is used up.
  await admin.reload();
  await expect(admin.getByRole('row', { name: /Nare Hakobyan/ })).toBeVisible();
  await expect(admin.getByText('Pending invitations')).toHaveCount(0);
});
