import { expect, test } from '@playwright/test';

test('admin surface is undiscoverable without credentials', async ({ request }) => {
  const response = await request.get('/api/admin/status');
  expect(response.status()).toBe(404);
});

test('concurrent repeat registration resolves to one learner', async ({ request }) => {
  const visitorUuid = crypto.randomUUID();
  const payload = {
    visitorUuid,
    sessionUuid: crypto.randomUUID(),
    landingPath: '/',
    deviceCategory: 'desktop',
    referrerCategory: 'direct',
  };
  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      request.post('/api/visitors/register', {
        data: payload,
        headers: {
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        },
      }),
    ),
  );
  expect(responses.every((response) => response.ok())).toBe(true);
  const bodies = await Promise.all(
    responses.map((response) => response.json() as Promise<{ learnerNumber: number }>),
  );
  expect(new Set(bodies.map((body) => body.learnerNumber)).size).toBe(1);
  const cleanup = await request.delete('/api/visitors/me', {
    headers: { 'x-anonymous-visitor': visitorUuid, 'x-confirm-delete': 'DELETE' },
  });
  expect(cleanup.ok()).toBe(true);
});

test('crawler traffic is not counted', async ({ request }) => {
  const response = await request.post('/api/visitors/register', {
    data: {
      visitorUuid: crypto.randomUUID(),
      sessionUuid: crypto.randomUUID(),
      landingPath: '/',
      deviceCategory: 'unknown',
      referrerCategory: 'direct',
    },
    headers: { 'user-agent': 'Googlebot/2.1' },
  });
  expect(response.status()).toBe(403);
});
