import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.afterEach(async ({ page, request }) => {
  if (!page.url().startsWith('http://127.0.0.1:5173')) return;
  const visitorUuid = await page.evaluate(() => localStorage.getItem('examforge.visitor_uuid'));
  if (visitorUuid) {
    await request.delete('/api/visitors/me', {
      headers: { 'x-anonymous-visitor': visitorUuid, 'x-confirm-delete': 'DELETE' },
    });
  }
});

test('creates an anonymous evidence-based study plan without an account', async ({ page }) => {
  const dashboardLoaded = page.waitForResponse(
    (response) => response.url().includes('/api/study/dashboard') && response.ok(),
  );
  await page.goto('/study');
  await expect(
    page.getByRole('heading', { name: 'Your mistakes become tomorrow’s worklist.' }),
  ).toBeVisible();
  await expect(
    page.getByText('No cited current-affairs entry has passed publication review.'),
  ).toBeVisible();
  await expect(
    page.getByText('No official calendar event has passed verification yet.'),
  ).toBeVisible();
  await dashboardLoaded;
  await page.getByLabel('Available minutes each day').fill('45');
  await page.getByRole('button', { name: 'Create my plan' }).click();
  await expect(page.getByText('Study plan updated from your real evidence.')).toBeVisible();
  await expect(page.getByRole('heading', { name: '45 focused minutes' })).toBeVisible();
  await expect(page.getByText('Baseline mock')).toBeVisible();
  await expect(page.getByText(/Complete a diagnostic test to replace this baseline/)).toBeVisible();
});

test('study desk has no serious accessibility violations', async ({ page }) => {
  await page.goto('/study');
  await expect(
    page.getByRole('heading', { name: 'Your mistakes become tomorrow’s worklist.' }),
  ).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(
    scan.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? '')),
  ).toEqual([]);
});
