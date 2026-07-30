import { zValidator } from '@hono/zod-validator';
import { isObviousCrawler } from '@shared/analytics';
import { consentSchema, pageEventSchema, visitorRegistrationSchema } from '@shared/visitor';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { authenticateAdmin } from './admin-auth';
import { attemptRoutes } from './attempt-routes';
import { adminRoutes, contentRoutes } from './content-routes';
import { validateRuntimeEnvironment } from './env';
import { getPublicFootfall, registerVisitor } from './footfall';
import { phaseFiveRoutes } from './phase-five-routes';
import { offlineRoutes } from './offline-routes';
import { securityHeaders } from './security';
import { verifyTurnstile } from './turnstile';
import { aiAssessmentRoutes } from './ai-assessment-routes';

interface AppEnvironment {
  Bindings: Env;
  Variables: { reviewerRef: string };
}

const app = new Hono<AppEnvironment>();

app.use('*', securityHeaders);
app.use('/api/*', async (context, next) => {
  const startedAt = Date.now();
  try {
    validateRuntimeEnvironment(context.env);
  } catch (error) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'invalid_runtime_environment',
        message: error instanceof Error ? error.message : 'Unknown validation error',
      }),
    );
    return context.json({ error: 'Service configuration is unavailable.' }, 503);
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(context.req.method)) {
    const origin = context.req.header('origin');
    const fetchSite = context.req.header('sec-fetch-site');
    const requestOrigin = new URL(context.req.url).origin;
    if ((origin && origin !== requestOrigin) || fetchSite === 'cross-site') {
      return context.json({ error: 'Cross-site request rejected.' }, 403);
    }
  }
  await next();
  const durationMs = Date.now() - startedAt;
  context.header('Server-Timing', `app;dur=${String(durationMs)}`);
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'api_request',
      method: context.req.method,
      path: context.req.path,
      status: context.res.status,
      durationMs,
    }),
  );
});

app.use('/api/admin/*', async (context, next) => {
  const variables = validateRuntimeEnvironment(context.env);
  const localToken = (context.env as Env & { LOCAL_ADMIN_TOKEN?: string }).LOCAL_ADMIN_TOKEN;
  const reviewerRef = await authenticateAdmin(context.req.raw, variables, localToken);
  if (!reviewerRef) return context.json({ error: 'Not found.' }, 404);
  context.set('reviewerRef', reviewerRef);
  await next();
});

app.route('/', contentRoutes);
app.route('/', adminRoutes);
app.route('/', attemptRoutes);
app.route('/', phaseFiveRoutes);
app.route('/', offlineRoutes);
app.route('/', aiAssessmentRoutes);

app.get('/api/health/live', (context) =>
  context.json({ status: 'ok', product: context.env.PRODUCT_NAME }),
);

app.get('/api/health', async (context) => {
  const variables = validateRuntimeEnvironment(context.env);
  const startedAt = Date.now();
  try {
    const [database, storage, content] = await Promise.all([
      context.env.DB.prepare('SELECT 1 AS ready').first<{ ready: number }>(),
      context.env.DOCUMENTS.head('__examforge_health_probe__'),
      context.env.DB.prepare(
        `SELECT MAX(version) AS version FROM (
           SELECT MAX(published_at) AS version FROM questions
           WHERE verification_status = 'published'
           UNION ALL
           SELECT MAX(published_at) AS version FROM notes
           WHERE verification_status = 'published'
         )`,
      ).first<{ version: string | null }>(),
    ]);
    return context.json({
      status: database?.ready === 1 ? 'ready' : 'degraded',
      product: variables.PRODUCT_NAME,
      environment: variables.APP_ENV,
      components: {
        app: 'ok',
        d1: database?.ready === 1 ? 'ok' : 'degraded',
        r2: storage === null ? 'ok-empty-probe' : 'ok',
        contentVersion: content?.version ?? 'no-published-content',
        groq: variables.GROQ_ENABLED === 'on' ? 'configured' : 'disabled',
      },
      latencyMs: Date.now() - startedAt,
    });
  } catch {
    return context.json(
      {
        status: 'degraded',
        product: variables.PRODUCT_NAME,
        environment: variables.APP_ENV,
        components: { app: 'ok', dependencies: 'unavailable' },
      },
      503,
    );
  }
});

app.get('/api/footfall', async (context) => {
  const totalLearners = await getPublicFootfall(context.env.DB, context.env.PUBLIC_CACHE);
  return context.json({ totalLearners }, 200, {
    'Cache-Control': 'public, max-age=15, stale-while-revalidate=30',
  });
});

app.post(
  '/api/visitors/register',
  zValidator('json', visitorRegistrationSchema),
  async (context) => {
    const userAgent = context.req.header('user-agent') ?? '';
    if (isObviousCrawler(userAgent)) {
      return context.json({ error: 'Automated traffic is not counted.' }, 403);
    }

    const input = context.req.valid('json');
    const rateKey = `rate:register:${input.visitorUuid}:${new Date().toISOString().slice(0, 16)}`;
    const requestCount = Number((await context.env.PUBLIC_CACHE.get(rateKey)) ?? '0');
    if (requestCount >= 20) {
      return context.json({ error: 'Too many requests. Please try again shortly.' }, 429);
    }
    await context.env.PUBLIC_CACHE.put(rateKey, String(requestCount + 1), {
      expirationTtl: 120,
    });

    const variables = validateRuntimeEnvironment(context.env);
    if (!(await verifyTurnstile(input.turnstileToken, variables))) {
      return context.json({ error: 'Human verification was not completed.' }, 403);
    }

    const result = await registerVisitor(context.env.DB, context.env.PUBLIC_CACHE, input);
    setCookie(context, 'examforge_visitor', input.visitorUuid, {
      httpOnly: false,
      maxAge: 60 * 60 * 24 * 400,
      path: '/',
      sameSite: 'Lax',
      secure: new URL(context.req.url).protocol === 'https:',
    });
    return context.json(result, result.isNewLearner ? 201 : 200);
  },
);

app.post('/api/events', zValidator('json', pageEventSchema), async (context) => {
  const input = context.req.valid('json');
  const rateKey = `rate:event:${input.visitorUuid}:${new Date().toISOString().slice(0, 16)}`;
  const requestCount = Number((await context.env.PUBLIC_CACHE.get(rateKey)) ?? '0');
  if (requestCount >= 120) return context.json({ error: 'Event rate limit reached.' }, 429);
  await context.env.PUBLIC_CACHE.put(rateKey, String(requestCount + 1), { expirationTtl: 120 });
  const visitor = await context.env.DB.prepare(
    'SELECT visitor_number FROM anonymous_visitors WHERE visitor_uuid = ?',
  )
    .bind(input.visitorUuid)
    .first<{ visitor_number: number }>();
  if (!visitor) throw new HTTPException(404, { message: 'Anonymous visitor not found.' });

  const consent = await context.env.DB.prepare(
    'SELECT anonymous_analytics FROM consent_preferences WHERE visitor_number = ?',
  )
    .bind(visitor.visitor_number)
    .first<{ anonymous_analytics: number }>();
  if (consent?.anonymous_analytics !== 1) return context.body(null, 204);

  await context.env.DB.prepare(
    `INSERT OR IGNORE INTO page_events
       (event_uuid, visitor_number, session_uuid, event_type, path,
        examination_slug, occurred_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      input.eventUuid,
      visitor.visitor_number,
      input.sessionUuid,
      input.eventType,
      input.path,
      input.examinationSlug ?? null,
      new Date().toISOString(),
    )
    .run();
  return context.body(null, 204);
});

app.put('/api/consent', zValidator('json', consentSchema), async (context) => {
  const input = context.req.valid('json');
  await context.env.DB.prepare(
    `UPDATE consent_preferences
       SET anonymous_analytics = ?, updated_at = ?
       WHERE visitor_number = (
         SELECT visitor_number FROM anonymous_visitors WHERE visitor_uuid = ?
       )`,
  )
    .bind(input.anonymousAnalytics ? 1 : 0, new Date().toISOString(), input.visitorUuid)
    .run();
  return context.body(null, 204);
});

app.delete('/api/visitors/me', async (context) => {
  if (context.req.header('x-confirm-delete') !== 'DELETE') {
    return context.json({ error: 'Explicit deletion confirmation is required.' }, 400);
  }
  const visitorUuid = context.req.header('x-anonymous-visitor');
  if (!visitorUuid || !visitorRegistrationSchema.shape.visitorUuid.safeParse(visitorUuid).success) {
    return context.json({ error: 'A valid anonymous visitor is required.' }, 400);
  }
  await context.env.DB.prepare('DELETE FROM anonymous_visitors WHERE visitor_uuid = ?')
    .bind(visitorUuid)
    .run();
  await context.env.PUBLIC_CACHE.delete('public:footfall');
  deleteCookie(context, 'examforge_visitor', { path: '/' });
  return context.body(null, 204);
});

app.notFound((context) => context.env.ASSETS.fetch(context.req.raw));

app.onError((error, context) => {
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'request_failure',
      path: context.req.path,
      message: error.message,
    }),
  );
  if (error instanceof HTTPException) return error.getResponse();
  return context.json({ error: 'An unexpected error occurred.' }, 500);
});

export default app;
