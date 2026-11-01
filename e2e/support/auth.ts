import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { API_URL, E2E, WEB_URL } from './env.ts';

/** Signs in through the login form and waits until the app has left the login page. */
export async function signIn(page: Page, email: string, password: string = E2E.password) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/login(\?|$)/);
}

/** An access token for direct api checks (same rules as the browser: Origin is required). */
export async function apiToken(request: APIRequestContext, email: string): Promise<string> {
  const res = await request.post(`${API_URL}/auth/login`, {
    headers: { Origin: WEB_URL },
    data: { email, password: E2E.password },
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { accessToken: string };
  return body.accessToken;
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}`, Origin: WEB_URL });
