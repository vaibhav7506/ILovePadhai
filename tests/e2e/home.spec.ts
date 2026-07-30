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

test('renders the examination desk without account UI', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Prepare from what is verified/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: '10th–12th level' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Graduation level' })).toBeVisible();
  await expect(page.getByText('Content under verification').first()).toBeVisible();
  await expect(page.getByText(/anonymous learners? (has|have) visited/).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /sign in|sign up/i })).toHaveCount(0);
});

test('anonymous identity persists without incrementing on reload', async ({ page }) => {
  await page.goto('/');
  const footfall = page.getByText(/You’re learner #/);
  await expect(footfall).toBeVisible();
  const initialText = await footfall.textContent();
  const initialId = await page.evaluate(() => localStorage.getItem('examforge.visitor_uuid'));

  await page.reload();
  await expect(page.getByText(initialText ?? '')).toBeVisible();
  const reloadedId = await page.evaluate(() => localStorage.getItem('examforge.visitor_uuid'));
  expect(reloadedId).toBe(initialId);
  expect(initialId).toMatch(/^[0-9a-f-]{36}$/i);
});

test('privacy page offers a persistent analytics opt-out', async ({ page }) => {
  await page.goto('/privacy');
  const toggle = page.getByRole('switch', { name: /Enabled/i });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.click();
  await expect(page.getByRole('switch', { name: /Opted out/i })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await page.reload();
  await expect(page.getByRole('switch', { name: /Opted out/i })).toHaveAttribute(
    'aria-checked',
    'false',
  );
});

test('leaderboard is honest, private by default, and empty without real entries', async ({
  page,
}) => {
  await page.goto('/leaderboards');
  await expect(
    page.getByRole('heading', { name: /leaderboard only when the papers truly match/i }),
  ).toBeVisible();
  await expect(page.getByText('No legitimate comparable entries yet.')).toBeVisible();
  await expect(page.getByText(/No seeded names. No fabricated rank./)).toBeVisible();
  await expect(page.getByText(/Private by default/)).toBeVisible();
});

test('mobile layout retains examination and footfall access', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile');
  await page.goto('/');
  await expect(page.getByText(/anonymous learners? (has|have) visited/).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: '10th–12th level' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Graduation level' })).toBeVisible();
});
