import { expect, test } from '@playwright/test';
import { apiToken, bearer, signIn } from '../support/auth.ts';
import { API_URL } from '../support/env.ts';

test('a PM cannot see another PM’s project', async ({ page, request }) => {
  // Marcus manages "Route Optimizer API"; Petra is not on it.
  const marcus = await apiToken(request, 'marcus.reed@tempo.test');
  const projects = (await (
    await request.get(`${API_URL}/projects`, { headers: bearer(marcus) })
  ).json()) as { id: string; name: string }[];
  const foreign = projects.find((p) => p.name === 'Route Optimizer API');
  expect(foreign).toBeDefined();

  await signIn(page, 'petra.neumann@tempo.test');
  await page.goto('/projects');
  await expect(page.getByText('Fleet Dashboard')).toBeVisible();
  await expect(page.getByText('Route Optimizer API')).toHaveCount(0);

  // Even by direct link: the same "not found" as a project that doesn't exist.
  await page.goto(`/projects/${foreign!.id}`);
  await expect(page.getByText('Project not found')).toBeVisible();

  // And the api agrees (404, not 403, so the project's existence isn't revealed).
  const petra = await apiToken(request, 'petra.neumann@tempo.test');
  for (const path of ['', '/members', '/usage']) {
    const res = await request.get(`${API_URL}/projects/${foreign!.id}${path}`, {
      headers: bearer(petra),
    });
    expect(res.status(), path).toBe(404);
  }
  const report = await request.get(
    `${API_URL}/reports?from=2026-01-01&to=2026-01-31&projectId=${foreign!.id}`,
    { headers: bearer(petra) },
  );
  expect(report.status()).toBe(404);
});
