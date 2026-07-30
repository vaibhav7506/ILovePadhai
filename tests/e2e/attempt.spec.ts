import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const attemptId = '11111111-1111-4111-8111-111111111111';

function activePayload(expiresInSeconds = 600, selectedOptionIndex: number | null = null) {
  const now = Date.now();
  return {
    attempt: {
      id: attemptId,
      mode: 'standard',
      status: 'active',
      durationSeconds: 3600,
      startedAt: new Date(now - 10_000).toISOString(),
      expiresAt: new Date(now + expiresInSeconds * 1000).toISOString(),
      submittedAt: null,
      score: null,
    },
    questions: [
      {
        id: 'question-1',
        position: 1,
        section: 'Reasoning',
        topic: 'Analogy',
        positiveMarks: 2,
        negativeMarks: 0.5,
        questionText: 'Which option completes the verified relationship?',
        selectedOptionIndex,
        markedForReview: false,
        visited: selectedOptionIndex !== null,
        clientRevision: selectedOptionIndex === null ? 0 : 1,
        options: [
          { optionIndex: 0, optionText: 'First option' },
          { optionIndex: 1, optionText: 'Second option' },
          { optionIndex: 2, optionText: 'Third option' },
          { optionIndex: 3, optionText: 'Fourth option' },
        ],
      },
      {
        id: 'question-2',
        position: 2,
        section: 'English',
        topic: 'Grammar',
        positiveMarks: 2,
        negativeMarks: 0.5,
        questionText: 'Choose the grammatically correct verified option.',
        selectedOptionIndex: null,
        markedForReview: false,
        visited: false,
        clientRevision: 0,
        options: [
          { optionIndex: 0, optionText: 'Option one' },
          { optionIndex: 1, optionText: 'Option two' },
          { optionIndex: 2, optionText: 'Option three' },
          { optionIndex: 3, optionText: 'Option four' },
        ],
      },
    ],
    serverTime: new Date(now).toISOString(),
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ id }) => localStorage.setItem(`examforge.attempt.${id}.token`, 'signed-fixture-token'),
    { id: attemptId },
  );
});

test.afterEach(async ({ page, request }) => {
  if (!page.url().startsWith('http://127.0.0.1:5173')) return;
  const visitorUuid = await page.evaluate(() => localStorage.getItem('examforge.visitor_uuid'));
  if (visitorUuid) {
    await request.delete('/api/visitors/me', {
      headers: { 'x-anonymous-visitor': visitorUuid, 'x-confirm-delete': 'DELETE' },
    });
  }
});

test('hides answers, synchronizes a response and recovers after refresh', async ({ page }) => {
  let selected: number | null = null;
  await page.route(`**/api/attempts/${attemptId}`, async (route) => {
    await route.fulfill({ json: activePayload(600, selected) });
  });
  await page.route(`**/api/attempts/${attemptId}/responses/question-1`, async (route) => {
    const body = route.request().postDataJSON() as { selectedOptionIndex: number };
    selected = body.selectedOptionIndex;
    await route.fulfill({ json: { status: 'saved', clientRevision: 1 } });
  });

  await page.goto(`/attempts/${attemptId}`);
  await expect(page.getByRole('heading', { name: /verified relationship/i })).toBeVisible();
  await expect(page.getByText(/correct answer/i)).toHaveCount(0);
  await page.locator('label').filter({ hasText: 'Second option' }).click();
  await expect(page.getByText('Saved to server')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Second option')).toBeChecked();
});

test('supports keyboard answers and mobile OMR navigation', async ({ page, isMobile }) => {
  await page.route(`**/api/attempts/${attemptId}`, async (route) => {
    await route.fulfill({ json: activePayload() });
  });
  await page.route(`**/api/attempts/${attemptId}/responses/question-1`, async (route) => {
    await route.fulfill({ json: { status: 'saved', clientRevision: 1 } });
  });
  await page.goto(`/attempts/${attemptId}`);
  await page.getByLabel('Examination workspace').press('ArrowRight');
  await expect(page.getByRole('heading', { name: /grammatically correct/i })).toBeVisible();
  await page.getByLabel('Examination workspace').press('ArrowLeft');
  await expect(page.getByRole('heading', { name: /verified relationship/i })).toBeVisible();
  await page.getByRole('button', { name: /Question 2:/ }).click();
  await expect(page.getByRole('heading', { name: /grammatically correct/i })).toBeVisible();
  if (isMobile) await expect(page.getByLabel('Question navigation')).toBeVisible();
});

test('auto-submits when the server-derived deadline expires', async ({ page }) => {
  let submitted = false;
  await page.route(`**/api/attempts/${attemptId}`, async (route) => {
    await route.fulfill({ json: activePayload(1) });
  });
  await page.route(`**/api/attempts/${attemptId}/submit`, async (route) => {
    submitted = true;
    await route.fulfill({
      json: {
        status: 'timed_out',
        score: { correct: 0, incorrect: 0, unattempted: 2, finalScore: 0, accuracy: 0 },
      },
    });
  });
  await page.goto(`/attempts/${attemptId}`);
  await expect.poll(() => submitted, { timeout: 5_000 }).toBe(true);
});

test('examination workspace has no serious accessibility violations', async ({ page }) => {
  await page.route(`**/api/attempts/${attemptId}`, async (route) => {
    await route.fulfill({ json: activePayload() });
  });
  await page.goto(`/attempts/${attemptId}`);
  await expect(page.getByRole('heading', { name: /verified relationship/i })).toBeVisible();
  const scan = await new AxeBuilder({ page }).analyze();
  expect(
    scan.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? '')),
  ).toEqual([]);
});
