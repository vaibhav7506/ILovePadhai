import { expect, test } from '@playwright/test';

test('PWA metadata and final health contract are available', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest',
  );
  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  const metadata = (await manifest.json()) as { name: string; display: string };
  expect(metadata.name).toContain('ExamForge');
  expect(metadata.display).toBe('standalone');
  expect((await request.get('/sw.js')).ok()).toBe(true);

  const health = await request.get('/api/health');
  expect(health.status()).toBe(200);
  const body = (await health.json()) as {
    status: string;
    components: { d1: string; r2: string; groq: string };
  };
  expect(body.status).toBe('ready');
  expect(body.components.d1).toBe('ok');
  expect(body.components.r2).toMatch(/^ok/);
  expect(body.components.groq).toBe('disabled');
});

test('offline library survives a network disconnect', async ({ page, context }) => {
  await page.goto('/offline');
  await expect(
    page.getByRole('heading', { name: 'Carry a small, verified library.' }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const browserNavigator = navigator as unknown as {
      serviceWorker: { ready: Promise<unknown> };
    };
    await browserNavigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Carry a small, verified library.' }),
  ).toBeVisible();
  await expect(
    page.getByText(/downloaded material|catalogue is unavailable|no published, verified/i),
  ).toBeVisible();
  await context.setOffline(false);
});

test('privacy reset requires explicit confirmation in UI and API', async ({ page, request }) => {
  await page.goto('/privacy');
  const reset = page.getByRole('button', { name: 'Reset my data' });
  await expect(reset).toBeDisabled();
  await page.getByPlaceholder('Type DELETE').fill('DELETE');
  await expect(reset).toBeEnabled();

  const visitorUuid = crypto.randomUUID();
  const registration = await request.post('/api/visitors/register', {
    data: {
      visitorUuid,
      sessionUuid: crypto.randomUUID(),
      landingPath: '/privacy',
      deviceCategory: 'desktop',
      referrerCategory: 'direct',
    },
  });
  expect(registration.ok()).toBe(true);
  expect(
    (
      await request.delete('/api/visitors/me', {
        headers: { 'x-anonymous-visitor': visitorUuid },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.delete('/api/visitors/me', {
        headers: { 'x-anonymous-visitor': visitorUuid, 'x-confirm-delete': 'DELETE' },
      })
    ).status(),
  ).toBe(204);
});

test('cross-site state changes are rejected', async ({ request }) => {
  const response = await request.post('/api/events', {
    headers: {
      Origin: 'https://attacker.example',
      'Sec-Fetch-Site': 'cross-site',
    },
    data: {
      eventUuid: crypto.randomUUID(),
      visitorUuid: crypto.randomUUID(),
      sessionUuid: crypto.randomUUID(),
      eventType: 'page_view',
      path: '/',
    },
  });
  expect(response.status()).toBe(403);
});
