import { zValidator } from '@hono/zod-validator';
import { leaderboardProfileSchema } from '@shared/attempt';
import { verifyAttemptToken } from '@shared/attempt-token';
import {
  RANK_COHORT_MINIMUM,
  calculateReadiness,
  compareCutoff,
  deriveResultInsights,
} from '@shared/result-analysis';
import type { ScoreSummary } from '@shared/scoring';
import { Hono } from 'hono';
import { z } from 'zod';

interface PhaseFourEnvironment {
  Bindings: Env;
}

interface PhaseFourAttempt {
  id: string;
  visitor_number: number;
  examination_id: string;
  status: string;
  comparison_key: string | null;
  integrity_status: string;
  integrity_flags_json: string;
  category: string | null;
  region: string | null;
  post_name: string | null;
  stage_name: string | null;
  tier_stage: string;
  score_json: string | null;
}

interface EntryRow {
  attempt_id: string;
  visitor_number: number;
  attempt_ordinal: number;
  score: number;
  max_marks: number;
  accuracy: number;
  completion_time_seconds: number;
  submitted_at: string;
  nickname: string | null;
  is_visible: number | null;
}

const routes = new Hono<PhaseFourEnvironment>();

function secret(env: Env): string | null {
  const value: unknown = Reflect.get(env, 'ATTEMPT_SIGNING_SECRET');
  return typeof value === 'string' && value.length >= 32 ? value : null;
}

async function attemptFor(
  request: Request,
  env: Env,
  id: string,
): Promise<PhaseFourAttempt | null> {
  const authorization = request.headers.get('authorization');
  const signingSecret = secret(env);
  if (!signingSecret || !authorization?.startsWith('Bearer ')) return null;
  const payload = await verifyAttemptToken(authorization.slice(7), signingSecret);
  if (payload?.attemptId !== id) return null;
  const attempt = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?')
    .bind(id)
    .first<PhaseFourAttempt>();
  return attempt?.visitor_number === payload.visitorNumber ? attempt : null;
}

function scoreOf(attempt: PhaseFourAttempt): ScoreSummary | null {
  return attempt.score_json ? (JSON.parse(attempt.score_json) as ScoreSummary) : null;
}

function best(entries: readonly EntryRow[]): EntryRow | undefined {
  return [...entries].sort(
    (a, b) =>
      b.score - a.score ||
      b.accuracy - a.accuracy ||
      a.completion_time_seconds - b.completion_time_seconds,
  )[0];
}

function selectScope(entries: readonly EntryRow[], scope: string): EntryRow[] {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const eligible =
    scope === 'weekly'
      ? entries.filter((entry) => Date.parse(entry.submitted_at) >= cutoff)
      : entries;
  const byVisitor = new Map<number, EntryRow[]>();
  for (const entry of eligible)
    byVisitor.set(entry.visitor_number, [...(byVisitor.get(entry.visitor_number) ?? []), entry]);
  return [...byVisitor.values()]
    .flatMap((visitorEntries) => {
      const fallback = visitorEntries[0];
      const selected =
        scope === 'first'
          ? (visitorEntries.find((entry) => entry.attempt_ordinal === 1) ?? fallback)
          : scope === 'latest'
            ? [...visitorEntries].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0]
            : best(visitorEntries);
      return selected ? [selected] : [];
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.accuracy - a.accuracy ||
        a.completion_time_seconds - b.completion_time_seconds,
    );
}

function cleanNickname(value: string): boolean {
  const normalized = value.toLowerCase().replaceAll(/[^a-z]/g, '');
  return !['fuck', 'shit', 'bitch', 'cunt', 'asshole'].some((term) => normalized.includes(term));
}

routes.put(
  '/api/attempts/:id/leaderboard-profile',
  zValidator('json', leaderboardProfileSchema),
  async (context) => {
    const attempt = await attemptFor(context.req.raw, context.env, context.req.param('id'));
    if (!attempt) return context.json({ error: 'Attempt not found.' }, 404);
    const input = context.req.valid('json');
    if (!cleanNickname(input.nickname))
      return context.json({ error: 'Choose a different nickname.' }, 400);
    await context.env.DB.prepare(
      `INSERT INTO leaderboard_profiles (visitor_number, nickname, is_visible, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(visitor_number) DO UPDATE SET
         nickname = excluded.nickname, is_visible = excluded.is_visible,
         updated_at = excluded.updated_at`,
    )
      .bind(attempt.visitor_number, input.nickname, input.visible ? 1 : 0, new Date().toISOString())
      .run();
    return context.json({ nickname: input.nickname, visible: input.visible });
  },
);

routes.get('/api/attempts/:id/leaderboard', async (context) => {
  const attempt = await attemptFor(context.req.raw, context.env, context.req.param('id'));
  if (!attempt) return context.json({ error: 'Attempt not found.' }, 404);
  if (!attempt.comparison_key)
    return context.json({ scope: 'best', entries: [], cohortSize: 0, comparable: false });
  const scope = context.req.query('scope') ?? 'best';
  if (!['first', 'best', 'latest', 'weekly', 'all_time'].includes(scope))
    return context.json({ error: 'Unknown leaderboard scope.' }, 400);
  const pagination = z
    .object({
      page: z.coerce.number().int().min(1).max(10_000).default(1),
      pageSize: z.coerce.number().int().min(10).max(50).default(25),
    })
    .safeParse({ page: context.req.query('page'), pageSize: context.req.query('pageSize') });
  if (!pagination.success) return context.json({ error: 'Invalid leaderboard page.' }, 400);
  const { results } = await context.env.DB.prepare(
    `SELECT le.*, lp.nickname, lp.is_visible
       FROM leaderboard_entries le
       JOIN attempts a ON a.id = le.attempt_id
       LEFT JOIN leaderboard_profiles lp ON lp.visitor_number = le.visitor_number
      WHERE le.comparison_key = ? AND a.integrity_status = 'legitimate'`,
  )
    .bind(attempt.comparison_key)
    .all<EntryRow>();
  const ranked = selectScope(results, scope).filter(
    (entry) => entry.is_visible === 1 || entry.visitor_number === attempt.visitor_number,
  );
  const { page, pageSize } = pagination.data;
  const offset = (page - 1) * pageSize;
  return context.json({
    scope,
    comparable: true,
    cohortSize: ranked.length,
    pagination: { page, pageSize, totalPages: Math.ceil(ranked.length / pageSize) },
    minimumForPercentile: RANK_COHORT_MINIMUM,
    entries: ranked.slice(offset, offset + pageSize).map((entry, index) => ({
      rank: offset + index + 1,
      nickname: entry.nickname ?? `Learner ${String(entry.visitor_number)}`,
      score: entry.score,
      maxMarks: entry.max_marks,
      accuracy: entry.accuracy,
      completionTimeSeconds: entry.completion_time_seconds,
      isYou: entry.visitor_number === attempt.visitor_number,
    })),
  });
});

routes.get('/api/attempts/:id/phase-four', async (context) => {
  const attempt = await attemptFor(context.req.raw, context.env, context.req.param('id'));
  if (!attempt) return context.json({ error: 'Attempt not found.' }, 404);
  const currentScore = scoreOf(attempt);
  if (!currentScore || attempt.status === 'active')
    return context.json({ error: 'Analysis is available after submission.' }, 403);

  const { results: history } = await context.env.DB.prepare(
    `SELECT * FROM attempts
      WHERE visitor_number = ? AND comparison_key = ? AND status IN ('submitted', 'timed_out')
        AND integrity_status = 'legitimate' AND score_json IS NOT NULL
      ORDER BY submitted_at DESC`,
  )
    .bind(attempt.visitor_number, attempt.comparison_key ?? '')
    .all<PhaseFourAttempt>();
  const scoredHistory = history
    .map((row) => ({ row, score: scoreOf(row) }))
    .filter((item): item is { row: PhaseFourAttempt; score: ScoreSummary } => item.score !== null);
  const currentIndex = scoredHistory.findIndex(({ row }) => row.id === attempt.id);
  const prior = currentIndex >= 0 ? scoredHistory[currentIndex + 1] : undefined;
  const first = scoredHistory.at(-1);
  const personalBest = [...scoredHistory].sort(
    (a, b) =>
      b.score.finalScore - a.score.finalScore ||
      b.score.accuracy - a.score.accuracy ||
      a.score.completionTimeSeconds - b.score.completionTimeSeconds,
  )[0];
  const recentPrior = scoredHistory.filter(({ row }) => row.id !== attempt.id).slice(0, 5);
  const recentAverage =
    recentPrior.length === 0
      ? null
      : {
          score:
            Math.round(
              (recentPrior.reduce((sum, item) => sum + item.score.finalScore, 0) /
                recentPrior.length) *
                100,
            ) / 100,
          accuracy:
            Math.round(
              (recentPrior.reduce((sum, item) => sum + item.score.accuracy, 0) /
                recentPrior.length) *
                100,
            ) / 100,
        };

  const cutoffParams = [attempt.examination_id, attempt.stage_name ?? attempt.tier_stage];
  let cutoffSql = `SELECT cutoff_marks AS score, year FROM cutoffs
    WHERE examination_id = ? AND tier_stage = ? AND verification_status = 'verified_official'`;
  for (const [column, value] of [
    ['category', attempt.category],
    ['region', attempt.region],
    ['post', attempt.post_name],
  ] as const) {
    cutoffSql += value ? ` AND ${column} = ?` : ` AND ${column} IS NULL`;
    if (value) cutoffParams.push(value);
  }
  const { results: cutoffRows } = await context.env.DB.prepare(cutoffSql)
    .bind(...cutoffParams)
    .all<{ score: number; year: number }>();
  const cutoff = compareCutoff(currentScore.finalScore, cutoffRows);
  const readiness = calculateReadiness(
    scoredHistory.slice(0, 5).map(({ score }) => score),
    cutoff,
  );

  const leaderboardRows = attempt.comparison_key
    ? await context.env.DB.prepare(
        `SELECT le.* FROM leaderboard_entries le
          JOIN attempts a ON a.id = le.attempt_id
         WHERE le.comparison_key = ? AND a.integrity_status = 'legitimate'`,
      )
        .bind(attempt.comparison_key)
        .all<EntryRow>()
    : { results: [] as EntryRow[] };
  const bestRanks = selectScope(leaderboardRows.results, 'best');
  const rankIndex = bestRanks.findIndex((entry) => entry.attempt_id === attempt.id);
  const canRank = bestRanks.length >= RANK_COHORT_MINIMUM && rankIndex >= 0;

  return context.json({
    insights: deriveResultInsights(currentScore),
    integrity: {
      status: attempt.integrity_status,
      flags: JSON.parse(attempt.integrity_flags_json) as string[],
      leaderboardEligible: attempt.integrity_status === 'legitimate',
    },
    comparison: {
      comparableAttempts: scoredHistory.length,
      previous: prior?.score ?? null,
      first: first?.score ?? null,
      personalBest: personalBest?.score ?? null,
      recentAverage,
      deltaFromPrevious: prior
        ? {
            score: Math.round((currentScore.finalScore - prior.score.finalScore) * 100) / 100,
            accuracy: Math.round((currentScore.accuracy - prior.score.accuracy) * 100) / 100,
            seconds: currentScore.completionTimeSeconds - prior.score.completionTimeSeconds,
            negativeMarks:
              Math.round((currentScore.negativeMarks - prior.score.negativeMarks) * 100) / 100,
          }
        : null,
    },
    cutoff,
    readiness,
    rank: canRank
      ? {
          available: true,
          rank: rankIndex + 1,
          cohortSize: bestRanks.length,
          percentile: Math.round(((bestRanks.length - rankIndex) / bestRanks.length) * 1000) / 10,
        }
      : {
          available: false,
          cohortSize: bestRanks.length,
          reason: `Rank and percentile appear after ${String(RANK_COHORT_MINIMUM)} legitimate comparable learners.`,
        },
  });
});

export { routes as phaseFourRoutes };
