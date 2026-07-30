import { zValidator } from '@hono/zod-validator';
import { createAttemptSchema, syncResponseSchema, type AttemptMode } from '@shared/attempt';
import {
  selectQuestions,
  type CandidateQuestion,
  type PatternConfiguration,
} from '@shared/attempt-selection';
import { signAttemptToken, verifyAttemptToken } from '@shared/attempt-token';
import { calculateScore, type ScorableQuestion } from '@shared/scoring';
import { phaseFourRoutes } from './phase-four-routes';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

interface AttemptEnvironment {
  Bindings: Env;
}

export interface AttemptRow {
  id: string;
  visitor_number: number;
  examination_id: string;
  mode: AttemptMode;
  status: 'active' | 'submitted' | 'timed_out' | 'abandoned';
  duration_seconds: number;
  started_at: string;
  expires_at: string;
  submitted_at: string | null;
  score_json: string | null;
  comparison_key: string | null;
  integrity_status: 'legitimate' | 'flagged' | 'excluded';
  answer_change_count: number;
  category: string | null;
  region: string | null;
  post_name: string | null;
  stage_name: string | null;
  generation_status?:
    'pending' | 'preparing' | 'generating' | 'deduplicating' | 'verifying' | 'ready' | 'failed';
}

// Phase 3 attempt lifecycle plus the additive Phase 4 analysis routes.
const routes = new Hono<AttemptEnvironment>();
const now = () => new Date().toISOString();

function signingSecret(env: Env): string | null {
  const secret: unknown = Reflect.get(env, 'ATTEMPT_SIGNING_SECRET');
  return typeof secret === 'string' && secret.length >= 32 ? secret : null;
}

async function publicCandidates(
  db: D1Database,
  examinationId: string,
): Promise<CandidateQuestion[]> {
  const { results } = await db
    .prepare(
      `SELECT q.id, q.document_id, q.section, q.subject, q.topic, q.difficulty,
              q.year, q.exam_date, q.shift, q.content_origin,
              q.positive_marks, q.negative_marks
         FROM questions q
        WHERE q.examination_id = ? AND q.verification_status = 'published'
          AND EXISTS (
            SELECT 1 FROM answer_key_versions k
             WHERE k.question_id = q.id AND k.is_current = 1
               AND ((q.content_origin = 'official_pyq' AND k.key_type = 'final')
                 OR (q.content_origin <> 'official_pyq' AND k.key_type = 'editorial'))
          )
        ORDER BY q.year DESC, q.exam_date DESC, q.section, q.id`,
    )
    .bind(examinationId)
    .all<CandidateQuestion>();
  return results;
}

export async function authorizedAttempt(
  request: Request,
  env: Env,
  attemptId: string,
): Promise<AttemptRow | null> {
  const secret = signingSecret(env);
  const authorization = request.headers.get('authorization');
  if (!secret || !authorization?.startsWith('Bearer ')) return null;
  const payload = await verifyAttemptToken(authorization.slice(7), secret);
  if (payload?.attemptId !== attemptId) return null;
  const attempt = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?')
    .bind(attemptId)
    .first<AttemptRow>();
  return attempt?.visitor_number === payload.visitorNumber ? attempt : null;
}

async function comparisonKey(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

async function submitAttempt(
  db: D1Database,
  attempt: AttemptRow,
): Promise<Record<string, unknown>> {
  if (attempt.status !== 'active') {
    return attempt.score_json ? (JSON.parse(attempt.score_json) as Record<string, unknown>) : {};
  }
  const { results } = await db
    .prepare(
      `SELECT aq.question_id AS id, aq.section, aq.subject, aq.topic, aq.difficulty,
              aq.positive_marks AS positiveMarks, aq.negative_marks AS negativeMarks,
              k.correct_option_index AS correctOptionIndex,
              r.selected_option_index AS selectedOptionIndex,
              COALESCE(r.time_spent_seconds, 0) AS timeSpentSeconds,
              COALESCE(r.marked_for_review, 0) AS markedForReview
         FROM attempt_questions aq
         LEFT JOIN attempt_responses r
           ON r.attempt_id = aq.attempt_id AND r.question_id = aq.question_id
         JOIN answer_key_versions k
           ON k.question_id = aq.question_id AND k.is_current = 1
        WHERE aq.attempt_id = ?
          AND ((k.key_type = 'final' AND EXISTS (
                 SELECT 1 FROM questions q WHERE q.id = aq.question_id
                   AND q.content_origin = 'official_pyq'))
            OR (k.key_type = 'editorial' AND EXISTS (
                 SELECT 1 FROM questions q WHERE q.id = aq.question_id
                   AND q.content_origin <> 'official_pyq')))
        ORDER BY aq.position`,
    )
    .bind(attempt.id)
    .all<ScorableQuestion & { markedForReview: number }>();
  if (results.length === 0) throw new Error('Attempt has no scorable questions.');
  const currentTime = Date.now();
  const completionTime = Math.min(
    attempt.duration_seconds,
    Math.max(0, Math.floor((currentTime - Date.parse(attempt.started_at)) / 1000)),
  );
  const score = calculateScore(results, completionTime);
  const timedOut = currentTime >= Date.parse(attempt.expires_at);
  const submittedAt = new Date(currentTime).toISOString();
  const integrityFlags: string[] = [];
  if (completionTime < Math.max(5, Math.ceil(results.length * 0.5)))
    integrityFlags.push('impossible_completion_time');
  if (attempt.answer_change_count > results.length * 8)
    integrityFlags.push('excessive_answer_changes');
  if (!attempt.comparison_key) integrityFlags.push('missing_comparison_key');
  const integrityStatus = integrityFlags.length === 0 ? 'legitimate' : 'flagged';
  const ordinal =
    (
      await db
        .prepare(
          `SELECT COUNT(*) AS count FROM leaderboard_entries
            WHERE visitor_number = ? AND comparison_key = ?`,
        )
        .bind(attempt.visitor_number, attempt.comparison_key ?? '')
        .first<{ count: number }>()
    )?.count ?? 0;
  await db.batch([
    ...results.map((question) => {
      const outcome =
        question.selectedOptionIndex === null
          ? 'unattempted'
          : question.selectedOptionIndex === question.correctOptionIndex
            ? 'correct'
            : 'incorrect';
      const awarded =
        outcome === 'correct'
          ? question.positiveMarks
          : outcome === 'incorrect'
            ? -question.negativeMarks
            : 0;
      return db
        .prepare(
          `INSERT OR IGNORE INTO attempt_question_results
           (attempt_id, question_id, selected_option_index, correct_option_index,
            outcome, score_awarded, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          attempt.id,
          question.id,
          question.selectedOptionIndex,
          question.correctOptionIndex,
          outcome,
          awarded,
          submittedAt,
        );
    }),
    db
      .prepare(
        `UPDATE attempts
            SET status = ?, submitted_at = ?, submission_reason = ?, score_json = ?,
                integrity_status = ?, integrity_flags_json = ?
          WHERE id = ? AND status = 'active'`,
      )
      .bind(
        timedOut ? 'timed_out' : 'submitted',
        submittedAt,
        timedOut ? 'timeout' : 'manual',
        JSON.stringify(score),
        integrityStatus,
        JSON.stringify(integrityFlags),
        attempt.id,
      ),
    ...integrityFlags.map((code) =>
      db
        .prepare(
          `INSERT INTO attempt_integrity_events
             (id, attempt_id, code, severity, detail, created_at)
           VALUES (?, ?, ?, 'review', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          attempt.id,
          code,
          `Server-side integrity check: ${code.replaceAll('_', ' ')}.`,
          submittedAt,
        ),
    ),
    db
      .prepare(
        `INSERT OR IGNORE INTO leaderboard_entries
           (attempt_id, visitor_number, comparison_key, attempt_ordinal, score, max_marks,
            accuracy, completion_time_seconds, submitted_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE ? = 'legitimate' AND ? <> ''`,
      )
      .bind(
        attempt.id,
        attempt.visitor_number,
        attempt.comparison_key ?? '',
        ordinal + 1,
        score.finalScore,
        score.maxMarks,
        score.accuracy,
        score.completionTimeSeconds,
        submittedAt,
        integrityStatus,
        attempt.comparison_key ?? '',
      ),
  ]);
  const tomorrow = new Date(currentTime + 24 * 60 * 60 * 1000).toISOString();
  const learningStatements = results.flatMap((question) => {
    const correct = question.selectedOptionIndex === question.correctOptionIndex;
    const outcome =
      question.selectedOptionIndex === null ? 'unattempted' : correct ? 'correct' : 'incorrect';
    const statements = [
      db
        .prepare(
          `INSERT INTO topic_mastery
             (visitor_number, examination_id, subject, topic, questions_seen,
              correct_count, incorrect_count, skipped_count, total_time_seconds,
              mastery_score, last_practised_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(visitor_number, examination_id, subject, topic) DO UPDATE SET
             questions_seen = questions_seen + 1,
             correct_count = correct_count + excluded.correct_count,
             incorrect_count = incorrect_count + excluded.incorrect_count,
             skipped_count = skipped_count + excluded.skipped_count,
             total_time_seconds = total_time_seconds + excluded.total_time_seconds,
             mastery_score = ROUND(
               (correct_count + excluded.correct_count) * 100.0 /
               (questions_seen + excluded.questions_seen), 2
             ),
             last_practised_at = excluded.last_practised_at`,
        )
        .bind(
          attempt.visitor_number,
          attempt.examination_id,
          question.subject ?? 'General',
          question.topic,
          correct ? 1 : 0,
          outcome === 'incorrect' ? 1 : 0,
          outcome === 'unattempted' ? 1 : 0,
          question.timeSpentSeconds,
          correct ? 100 : 0,
          submittedAt,
        ),
    ];
    if (outcome !== 'correct' || question.markedForReview === 1) {
      const sourceOutcome = outcome === 'correct' ? 'marked' : outcome;
      statements.push(
        db
          .prepare(
            `INSERT INTO mistake_notebook
               (visitor_number, question_id, attempt_id, source_outcome, revision_status,
                interval_days, review_count, next_review_at, bookmarked, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'scheduled', 1, 0, ?, 0, ?, ?)
             ON CONFLICT(visitor_number, question_id) DO UPDATE SET
               attempt_id = excluded.attempt_id, source_outcome = excluded.source_outcome,
               revision_status = 'scheduled', interval_days = 1,
               next_review_at = excluded.next_review_at, updated_at = excluded.updated_at`,
          )
          .bind(
            attempt.visitor_number,
            question.id,
            attempt.id,
            sourceOutcome,
            tomorrow,
            submittedAt,
            submittedAt,
          ),
      );
    }
    return statements;
  });
  await db.batch([
    ...learningStatements,
    db
      .prepare(
        `INSERT INTO study_profiles
           (visitor_number, target_examination_id, daily_minutes, plan_paused,
            current_streak, last_study_date, created_at, updated_at)
         SELECT ?, ?, 60, 0, 1, date(?), ?, ?
          WHERE ? = 'diagnostic'
         ON CONFLICT(visitor_number) DO UPDATE SET
           target_examination_id = COALESCE(study_profiles.target_examination_id, excluded.target_examination_id),
           current_streak = CASE
             WHEN study_profiles.last_study_date = date(?, '-1 day') THEN study_profiles.current_streak + 1
             WHEN study_profiles.last_study_date = date(?) THEN study_profiles.current_streak
             ELSE 1 END,
           last_study_date = date(?), updated_at = excluded.updated_at`,
      )
      .bind(
        attempt.visitor_number,
        attempt.examination_id,
        submittedAt,
        submittedAt,
        submittedAt,
        attempt.mode,
        submittedAt,
        submittedAt,
        submittedAt,
      ),
  ]);
  return score as unknown as Record<string, unknown>;
}

routes.get('/api/test-config', async (context) => {
  const { results } = await context.env.DB.prepare(
    `SELECT e.slug, e.short_name AS shortName, e.full_name AS fullName,
            e.qualification_level AS qualificationLevel,
            p.tier_stage AS tierStage, p.total_questions AS totalQuestions,
            p.standard_duration_minutes AS durationMinutes,
            p.negative_marking AS negativeMarking,
            (SELECT COUNT(*) FROM questions q
              WHERE q.examination_id = e.id AND q.verification_status = 'published') AS publishedQuestions
       FROM examinations e
       LEFT JOIN examination_patterns p ON p.examination_id = e.id
         AND p.verification_status = 'verified_official' AND p.enabled = 1
      WHERE e.enabled = 1 ORDER BY e.priority, p.effective_from DESC`,
  ).all();
  return context.json({
    examinations: results,
    modes: ['standard', 'custom', 'previous_year', 'diagnostic'],
  });
});

routes.post('/api/attempts', zValidator('json', createAttemptSchema), async (context) => {
  const secret = signingSecret(context.env);
  if (!secret) return context.json({ error: 'Attempt service is not configured.' }, 503);
  const input = context.req.valid('json');
  const visitor = await context.env.DB.prepare(
    'SELECT visitor_number FROM anonymous_visitors WHERE visitor_uuid = ?',
  )
    .bind(input.visitorUuid)
    .first<{ visitor_number: number }>();
  if (!visitor) throw new HTTPException(404, { message: 'Anonymous visitor not found.' });
  const examination = await context.env.DB.prepare(
    'SELECT id, short_name FROM examinations WHERE slug = ? AND enabled = 1',
  )
    .bind(input.examinationSlug)
    .first<{ id: string; short_name: string }>();
  if (!examination) throw new HTTPException(404, { message: 'Examination not found.' });
  const pattern = await context.env.DB.prepare(
    `SELECT id, sections_json, subjects_json, total_questions, standard_duration_minutes
         FROM examination_patterns
        WHERE examination_id = ? AND tier_stage = ?
          AND verification_status = 'verified_official' AND enabled = 1
        ORDER BY effective_from DESC LIMIT 1`,
  )
    .bind(examination.id, input.tierStage)
    .first<PatternConfiguration>();
  let candidates = await publicCandidates(context.env.DB, examination.id);
  if (input.mode === 'custom' && input.custom?.weakQuestionsOnly) {
    const { results: weakRows } = await context.env.DB.prepare(
      `SELECT DISTINCT qr.question_id AS id
           FROM attempt_question_results qr
           JOIN attempts a ON a.id = qr.attempt_id
          WHERE a.visitor_number = ? AND qr.outcome = 'incorrect'`,
    )
      .bind(visitor.visitor_number)
      .all<{ id: string }>();
    const weakIds = new Set(weakRows.map((row) => row.id));
    candidates = candidates.filter((question) => weakIds.has(question.id));
  }
  const selection = selectQuestions(candidates, pattern, input);
  if (
    selection.questions.length === 0 ||
    (input.mode === 'standard' && selection.questions.length !== pattern?.total_questions) ||
    (input.mode === 'custom' &&
      selection.questions.length < (input.custom?.questionCount ?? Number.POSITIVE_INFINITY))
  ) {
    return context.json(
      {
        error:
          input.custom?.weakQuestionsOnly === true
            ? 'No previously incorrect verified questions satisfy this selection.'
            : 'Not enough published, verified questions satisfy this mode.',
      },
      409,
    );
  }
  const attemptId = crypto.randomUUID();
  const comparable = await comparisonKey({
    examination: examination.id,
    pattern: pattern?.id ?? null,
    mode: input.mode,
    tier: input.tierStage,
    duration: selection.durationSeconds,
    questions: selection.questions.map((question) => [
      question.id,
      question.positive_marks,
      question.negative_marks,
    ]),
  });
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + selection.durationSeconds * 1000);
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO attempts
         (id, visitor_number, examination_id, pattern_id, mode, tier_stage, nickname,
          category, region, post_name, stage_name, selection_json, comparison_key,
          status, question_count, duration_seconds,
          started_at, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
    ).bind(
      attemptId,
      visitor.visitor_number,
      examination.id,
      pattern?.id ?? null,
      input.mode,
      input.tierStage,
      input.nickname ?? null,
      input.category ?? null,
      input.region ?? null,
      input.post ?? null,
      input.stage ?? input.tierStage,
      JSON.stringify(input),
      comparable,
      selection.questions.length,
      selection.durationSeconds,
      startedAt.toISOString(),
      expiresAt.toISOString(),
      startedAt.toISOString(),
    ),
    ...selection.questions.flatMap((question, index) => [
      context.env.DB.prepare(
        `INSERT INTO attempt_questions
           (attempt_id, question_id, position, section, subject, topic, difficulty,
            positive_marks, negative_marks)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        attemptId,
        question.id,
        index + 1,
        question.section,
        question.subject,
        question.topic,
        question.difficulty,
        question.positive_marks,
        question.negative_marks,
      ),
      context.env.DB.prepare(
        `INSERT INTO attempt_responses
           (attempt_id, question_id, selected_option_index, marked_for_review, visited,
            client_elapsed_seconds, client_revision)
           VALUES (?, ?, NULL, 0, 0, 0, 0)`,
      ).bind(attemptId, question.id),
    ]),
  ]);
  const token = await signAttemptToken(
    {
      attemptId,
      visitorNumber: visitor.visitor_number,
      issuedAt: Math.floor(startedAt.getTime() / 1000),
      nonce: crypto.randomUUID(),
    },
    secret,
  );
  return context.json(
    {
      attemptId,
      attemptToken: token,
      examination: examination.short_name,
      mode: input.mode,
      questionCount: selection.questions.length,
      durationSeconds: selection.durationSeconds,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
    201,
  );
});

routes.get('/api/attempts/:id', async (context) => {
  let attempt = await authorizedAttempt(context.req.raw, context.env, context.req.param('id'));
  if (!attempt) return context.json({ error: 'Attempt not found.' }, 404);
  if (attempt.generation_status && attempt.generation_status !== 'ready') {
    return context.json({ error: 'The complete verified test is not ready yet.' }, 409);
  }
  if (attempt.status === 'active' && Date.now() >= Date.parse(attempt.expires_at)) {
    await submitAttempt(context.env.DB, attempt);
    attempt =
      (await context.env.DB.prepare('SELECT * FROM attempts WHERE id = ?')
        .bind(attempt.id)
        .first<AttemptRow>()) ?? attempt;
  }
  const { results: questions } = await context.env.DB.prepare(
    `SELECT aq.question_id AS id, aq.position, aq.section, aq.topic,
            aq.positive_marks AS positiveMarks, aq.negative_marks AS negativeMarks,
            q.question_text AS questionText, q.language, q.content_origin AS contentOrigin,
            r.selected_option_index AS selectedOptionIndex,
            r.marked_for_review AS markedForReview, r.visited,
            r.client_revision AS clientRevision,
            r.time_spent_seconds AS timeSpentSeconds
       FROM attempt_questions aq
       JOIN questions q ON q.id = aq.question_id
       JOIN attempt_responses r
         ON r.attempt_id = aq.attempt_id AND r.question_id = aq.question_id
      WHERE aq.attempt_id = ? ORDER BY aq.position`,
  )
    .bind(attempt.id)
    .all<Record<string, unknown> & { id: string }>();
  const withOptions = await Promise.all(
    questions.map(async (question) => {
      const { results: options } = await context.env.DB.prepare(
        `SELECT option_index AS optionIndex, option_text AS optionText
           FROM question_options WHERE question_id = ? ORDER BY option_index`,
      )
        .bind(question.id)
        .all();
      return { ...question, options };
    }),
  );
  return context.json({
    attempt: {
      id: attempt.id,
      mode: attempt.mode,
      status: attempt.status,
      durationSeconds: attempt.duration_seconds,
      startedAt: attempt.started_at,
      expiresAt: attempt.expires_at,
      submittedAt: attempt.submitted_at,
      score: attempt.score_json ? (JSON.parse(attempt.score_json) as unknown) : null,
    },
    questions: withOptions,
    serverTime: now(),
  });
});

routes.put(
  '/api/attempts/:id/responses/:questionId',
  zValidator('json', syncResponseSchema),
  async (context) => {
    const attempt = await authorizedAttempt(context.req.raw, context.env, context.req.param('id'));
    if (!attempt) return context.json({ error: 'Attempt not found.' }, 404);
    if (attempt.generation_status && attempt.generation_status !== 'ready')
      return context.json({ error: 'The complete verified test is not ready yet.' }, 409);
    if (attempt.status !== 'active')
      return context.json({ error: 'Attempt is already final.' }, 409);
    if (Date.now() >= Date.parse(attempt.expires_at)) {
      const score = await submitAttempt(context.env.DB, attempt);
      return context.json({ error: 'Time expired.', status: 'timed_out', score }, 409);
    }
    const input = context.req.valid('json');
    const previous = await context.env.DB.prepare(
      `SELECT selected_option_index AS selectedOptionIndex
         FROM attempt_responses WHERE attempt_id = ? AND question_id = ?`,
    )
      .bind(attempt.id, context.req.param('questionId'))
      .first<{ selectedOptionIndex: number | null }>();
    const result = await context.env.DB.prepare(
      `UPDATE attempt_responses
          SET selected_option_index = ?, marked_for_review = ?, visited = 1,
              client_elapsed_seconds = ?, client_revision = ?, mutation_id = ?,
              time_spent_seconds = MAX(time_spent_seconds, ?), server_updated_at = ?
        WHERE attempt_id = ? AND question_id = ? AND client_revision < ?`,
    )
      .bind(
        input.selectedOptionIndex,
        input.markedForReview ? 1 : 0,
        input.clientElapsedSeconds,
        input.clientRevision,
        input.mutationId,
        input.questionElapsedSeconds,
        now(),
        attempt.id,
        context.req.param('questionId'),
        input.clientRevision,
      )
      .run();
    if (result.meta.changes === 0) {
      const existing = await context.env.DB.prepare(
        `SELECT client_revision FROM attempt_responses WHERE attempt_id = ? AND question_id = ?`,
      )
        .bind(attempt.id, context.req.param('questionId'))
        .first<{ client_revision: number }>();
      if (!existing) throw new HTTPException(404, { message: 'Attempt question not found.' });
      return context.json({ status: 'stale_ignored', clientRevision: existing.client_revision });
    }
    if (
      previous?.selectedOptionIndex !== null &&
      previous?.selectedOptionIndex !== input.selectedOptionIndex
    ) {
      await context.env.DB.prepare(
        'UPDATE attempts SET answer_change_count = answer_change_count + 1 WHERE id = ?',
      )
        .bind(attempt.id)
        .run();
    }
    return context.json({ status: 'saved', clientRevision: input.clientRevision });
  },
);

routes.post('/api/attempts/:id/submit', async (context) => {
  const attempt = await authorizedAttempt(context.req.raw, context.env, context.req.param('id'));
  if (!attempt) return context.json({ error: 'Attempt not found.' }, 404);
  const score = await submitAttempt(context.env.DB, attempt);
  const status = Date.now() >= Date.parse(attempt.expires_at) ? 'timed_out' : 'submitted';
  return context.json({ status: attempt.status === 'active' ? status : attempt.status, score });
});

routes.get('/api/attempts/:id/results', async (context) => {
  const attempt = await authorizedAttempt(context.req.raw, context.env, context.req.param('id'));
  if (!attempt) return context.json({ error: 'Attempt not found.' }, 404);
  if (attempt.status === 'active')
    return context.json({ error: 'Results are hidden until submission.' }, 403);
  const { results } = await context.env.DB.prepare(
    `SELECT aq.position, q.id, q.question_text AS questionText,
            q.explanation_markdown AS explanationMarkdown,
            r.selected_option_index AS selectedOptionIndex,
            qr.correct_option_index AS correctOptionIndex, qr.outcome,
            qr.score_awarded AS scoreAwarded, q.source_page AS sourcePage,
            q.official_question_id AS officialQuestionId, s.source_url AS sourceUrl,
            (SELECT n.title FROM note_related_questions nr
              JOIN notes n ON n.id = nr.note_id
             WHERE nr.question_id = q.id AND n.verification_status = 'published'
             ORDER BY n.published_at DESC LIMIT 1) AS relatedNote
       FROM attempt_questions aq
       JOIN questions q ON q.id = aq.question_id
       JOIN attempt_question_results qr
         ON qr.attempt_id = aq.attempt_id AND qr.question_id = aq.question_id
       LEFT JOIN attempt_responses r
         ON r.attempt_id = aq.attempt_id AND r.question_id = aq.question_id
       JOIN source_documents d ON d.id = q.document_id
       JOIN official_sources s ON s.id = d.source_id
      WHERE aq.attempt_id = ? ORDER BY aq.position`,
  )
    .bind(attempt.id)
    .all();
  return context.json({
    status: attempt.status,
    score: attempt.score_json ? (JSON.parse(attempt.score_json) as unknown) : null,
    questions: results,
  });
});

export { routes as attemptRoutes };
routes.route('/', phaseFourRoutes);
