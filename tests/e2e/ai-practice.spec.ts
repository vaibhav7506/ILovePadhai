import { expect, test } from '@playwright/test';

test('AI practice is the primary configurable flow and fails safely without Groq', async ({
  page,
}) => {
  await page.route('**/api/ai/attempts', async (route) => {
    await route.fulfill({
      status: 503,
      json: {
        error:
          'AI practice is temporarily unavailable. Existing results and study tools remain available.',
      },
    });
  });
  await page.goto('/practice');
  await expect(page.getByRole('heading', { name: /Build a fresh test/i })).toBeVisible();
  await expect(page.getByLabel('Examination')).toHaveValue('ssc-chsl');
  await page.getByLabel('Subject').selectOption('Quantitative Aptitude');
  await expect(page.getByLabel('Questions')).toHaveValue('10');
  await expect(page.getByLabel('Difficulty')).toHaveValue('medium');
  await expect(page.getByLabel('Minutes')).toHaveValue('10');
  await page.getByRole('button', { name: 'Start AI test' }).click();
  await expect(page.getByRole('alert')).toContainText('AI practice is temporarily unavailable');
});

test('verification cooldown preserves and automatically retries the same attempt once', async ({
  page,
}) => {
  let createCalls = 0;
  let generateCalls = 0;
  await page.route('**/api/ai/attempts', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    createCalls += 1;
    await route.fulfill({
      status: 202,
      json: {
        attemptId: 'attempt-rate-limited',
        attemptToken: 'test-attempt-token-that-is-long-enough',
        generationStatus: 'pending',
      },
    });
  });
  await page.route('**/api/ai/attempts/attempt-rate-limited/generate*', async (route) => {
    generateCalls += 1;
    if (generateCalls === 1) {
      await route.fulfill({
        status: 429,
        json: {
          error: 'AI provider is cooling down. Your generated questions are safely preserved.',
          errorCode: 'AI_RATE_LIMITED',
          stage: 'verification',
          retryAfterSeconds: 1,
        },
      });
      return;
    }
    expect(route.request().url()).toContain('retry=automatic');
    await route.fulfill({
      status: 200,
      json: {
        attemptId: 'attempt-rate-limited',
        questionCount: 5,
        generationStatus: 'ready',
      },
    });
  });
  await page.route('**/api/ai/attempts/attempt-rate-limited/generation', async (route) => {
    await route.fulfill({
      status: 200,
      json:
        generateCalls < 2
          ? {
              status: 'rate_limited',
              stageLabel: 'Provider cooldown',
              retryStage: 'verification',
              cooldownUntil: new Date(Date.now() + 1_000).toISOString(),
              autoRetryUsed: 0,
            }
          : { status: 'completed', stageLabel: 'Test ready' },
    });
  });
  await page.route('**/api/attempts/attempt-rate-limited', async (route) => {
    await route.fulfill({ status: 409, json: { error: 'Mock attempt view.' } });
  });

  await page.goto('/practice');
  await page.getByLabel('Questions').selectOption('5');
  await page.getByRole('button', { name: 'Start AI test' }).click();
  const cooldown = page.getByRole('status');
  await expect(cooldown).toContainText('generated questions are saved');
  await expect(page.getByRole('button', { name: /Retry available in/ })).toBeDisabled();
  await expect(page).toHaveURL(/\/attempts\/attempt-rate-limited$/, { timeout: 10_000 });
  expect(createCalls).toBe(1);
  expect(generateCalls).toBe(2);
});
