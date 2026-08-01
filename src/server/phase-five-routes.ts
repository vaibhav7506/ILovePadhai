import { zValidator } from '@hono/zod-validator';
import { parseRetryAfterSeconds } from '@shared/ai-assessment';
import {
  buildDailyPlan,
  doubtRequestSchema,
  mistakeUpdateSchema,
  nextRevision,
  planItemUpdateSchema,
  lessonEngagementSchema,
  comprehensionSubmitSchema,
  studyCompletionPercent,
  revisionReviewSchema,
  studyProfileSchema,
  type MasteryEvidence,
} from '@shared/study';
import { z } from 'zod';
import { Hono } from 'hono';
import {
  acquireProviderGate,
  recordProviderCooldown,
  releaseProviderGate,
} from './ai-assessment-routes';
import { validateRuntimeEnvironment } from './env';
import { verifyTurnstile } from './turnstile';

interface PhaseFiveEnvironment {
  Bindings: Env;
}

interface Visitor {
  visitor_number: number;
}

interface StudyProfileRow {
  visitor_number: number;
  target_examination_id: string | null;
  expected_exam_date: string | null;
  daily_minutes: number;
  plan_paused: number;
  current_streak: number;
  last_study_date: string | null;
  target_slug: string | null;
  target_name: string | null;
}

interface MasteryRow {
  subject: string;
  topic: string;
  questionsSeen: number;
  correctCount: number;
  incorrectCount: number;
  skippedCount: number;
  totalTimeSeconds: number;
  masteryScore: number;
  lastPractisedAt: string;
}

const routes = new Hono<PhaseFiveEnvironment>();
const isoNow = () => new Date().toISOString();
const today = () => isoNow().slice(0, 10);

async function visitorFor(db: D1Database, visitorUuid: string): Promise<Visitor | null> {
  return db
    .prepare('SELECT visitor_number FROM anonymous_visitors WHERE visitor_uuid = ?')
    .bind(visitorUuid)
    .first<Visitor>();
}

async function profileFor(db: D1Database, visitorNumber: number): Promise<StudyProfileRow | null> {
  return db
    .prepare(
      `SELECT sp.*, e.slug AS target_slug, e.short_name AS target_name
         FROM study_profiles sp
         LEFT JOIN examinations e ON e.id = sp.target_examination_id
        WHERE sp.visitor_number = ?`,
    )
    .bind(visitorNumber)
    .first<StudyProfileRow>();
}

async function masteryFor(
  db: D1Database,
  visitorNumber: number,
  examinationId?: string | null,
): Promise<MasteryEvidence[]> {
  let sql = `SELECT subject, topic, questions_seen AS questionsSeen,
    correct_count AS correctCount, incorrect_count AS incorrectCount,
    skipped_count AS skippedCount, total_time_seconds AS totalTimeSeconds,
    mastery_score AS masteryScore, last_practised_at AS lastPractisedAt
    FROM topic_mastery WHERE visitor_number = ?`;
  const bindings: (string | number)[] = [visitorNumber];
  if (examinationId) {
    sql += ' AND examination_id = ?';
    bindings.push(examinationId);
  }
  sql += ' ORDER BY mastery_score, last_practised_at';
  const { results } = await db
    .prepare(sql)
    .bind(...bindings)
    .all<MasteryRow>();
  return results;
}

async function refreshPlan(
  db: D1Database,
  profile: StudyProfileRow,
): Promise<Record<string, unknown>[]> {
  const mastery = await masteryFor(db, profile.visitor_number, profile.target_examination_id);
  const due =
    (
      await db
        .prepare(
          `SELECT COUNT(*) AS count FROM mistake_notebook
            WHERE visitor_number = ? AND revision_status <> 'mastered' AND next_review_at <= ?`,
        )
        .bind(profile.visitor_number, isoNow())
        .first<{ count: number }>()
    )?.count ?? 0;
  const recommendations = buildDailyPlan(profile.daily_minutes, mastery, due);
  const date = today();
  await db.batch([
    db
      .prepare(
        `DELETE FROM study_plan_items
          WHERE visitor_number = ? AND plan_date = ? AND status = 'planned'`,
      )
      .bind(profile.visitor_number, date),
    ...recommendations.map((item) =>
      db
        .prepare(
          `INSERT INTO study_plan_items
             (id, visitor_number, plan_date, item_type, subject, topic, minutes,
              rationale, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned', ?)`,
        )
        .bind(
          crypto.randomUUID(),
          profile.visitor_number,
          date,
          item.itemType,
          item.subject,
          item.topic,
          item.minutes,
          item.rationale,
          isoNow(),
        ),
    ),
  ]);
  const { results } = await db
    .prepare(
      `SELECT id, item_type AS itemType, subject, topic, minutes, rationale, status
         FROM study_plan_items WHERE visitor_number = ? AND plan_date = ?
         ORDER BY created_at`,
    )
    .bind(profile.visitor_number, date)
    .all();
  return results;
}

routes.get('/api/study/profile', async (context) => {
  const parsed = z.uuid().safeParse(context.req.query('visitorUuid'));
  if (!parsed.success) return context.json({ error: 'Valid anonymous visitor required.' }, 400);
  const visitor = await visitorFor(context.env.DB, parsed.data);
  if (!visitor) return context.json({ error: 'Anonymous visitor not found.' }, 404);
  const profile = await profileFor(context.env.DB, visitor.visitor_number);
  return context.json({
    profile: profile
      ? {
          targetExaminationSlug: profile.target_slug,
          targetExamination: profile.target_name,
          expectedExamDate: profile.expected_exam_date,
          dailyMinutes: profile.daily_minutes,
          paused: profile.plan_paused === 1,
          currentStreak: profile.current_streak,
          lastStudyDate: profile.last_study_date,
        }
      : null,
  });
});

routes.put('/api/study/profile', zValidator('json', studyProfileSchema), async (context) => {
  const input = context.req.valid('json');
  const visitor = await visitorFor(context.env.DB, input.visitorUuid);
  if (!visitor) return context.json({ error: 'Anonymous visitor not found.' }, 404);
  const examination = input.targetExaminationSlug
    ? await context.env.DB.prepare('SELECT id FROM examinations WHERE slug = ? AND enabled = 1')
        .bind(input.targetExaminationSlug)
        .first<{ id: string }>()
    : null;
  if (input.targetExaminationSlug && !examination)
    return context.json({ error: 'Target examination not found.' }, 404);
  const timestamp = isoNow();
  await context.env.DB.prepare(
    `INSERT INTO study_profiles
         (visitor_number, target_examination_id, expected_exam_date, daily_minutes,
          plan_paused, current_streak, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)
       ON CONFLICT(visitor_number) DO UPDATE SET
         target_examination_id = excluded.target_examination_id,
         expected_exam_date = excluded.expected_exam_date,
         daily_minutes = excluded.daily_minutes,
         plan_paused = excluded.plan_paused,
         updated_at = excluded.updated_at`,
  )
    .bind(
      visitor.visitor_number,
      examination?.id ?? null,
      input.expectedExamDate,
      input.dailyMinutes,
      input.paused ? 1 : 0,
      timestamp,
      timestamp,
    )
    .run();
  const profile = await profileFor(context.env.DB, visitor.visitor_number);
  if (profile && !profile.plan_paused) await refreshPlan(context.env.DB, profile);
  return context.json({ status: 'saved' });
});

routes.get('/api/study/dashboard', async (context) => {
  const parsed = z.uuid().safeParse(context.req.query('visitorUuid'));
  if (!parsed.success) return context.json({ error: 'Valid anonymous visitor required.' }, 400);
  const visitor = await visitorFor(context.env.DB, parsed.data);
  if (!visitor) return context.json({ error: 'Anonymous visitor not found.' }, 404);
  const profile = await profileFor(context.env.DB, visitor.visitor_number);
  const mastery = await masteryFor(
    context.env.DB,
    visitor.visitor_number,
    profile?.target_examination_id,
  );
  const { results: mistakes } = await context.env.DB.prepare(
    `SELECT mn.question_id AS questionId, q.question_text AS questionText,
              q.subject, q.topic, q.difficulty, mn.source_outcome AS sourceOutcome,
              mn.mistake_reason AS mistakeReason, mn.revision_status AS revisionStatus,
              mn.next_review_at AS nextReviewAt, mn.review_count AS reviewCount,
              mn.bookmarked
         FROM mistake_notebook mn
         JOIN questions q ON q.id = mn.question_id
        WHERE mn.visitor_number = ?
        ORDER BY mn.next_review_at, mn.updated_at DESC LIMIT 100`,
  )
    .bind(visitor.visitor_number)
    .all();
  let plan: Record<string, unknown>[] = [];
  if (profile) {
    const { results } = await context.env.DB.prepare(
      `SELECT p.id, p.item_type AS itemType, p.subject, p.topic, p.minutes, p.rationale,
              p.status, COALESCE(l.state, CASE WHEN p.status='skipped' THEN 'skipped' ELSE 'not_started' END) AS learningState
           FROM study_plan_items p LEFT JOIN study_task_learning l ON l.plan_item_id=p.id
          WHERE p.visitor_number = ? AND p.plan_date = ?
           ORDER BY created_at`,
    )
      .bind(visitor.visitor_number, today())
      .all();
    plan = results;
    if (plan.length === 0 && !profile.plan_paused)
      plan = await refreshPlan(context.env.DB, profile);
  }
  const learningCounts = { completed: 0, retryRequired: 0, skipped: 0, planned: 0 };
  for (const item of plan) {
    const learningState: unknown = Reflect.get(item, 'learningState');
    const state = typeof learningState === 'string' ? learningState : 'not_started';
    if (state === 'completed') learningCounts.completed += 1;
    else if (state === 'retry_required') learningCounts.retryRequired += 1;
    else if (state === 'skipped') learningCounts.skipped += 1;
    else learningCounts.planned += 1;
  }
  return context.json({
    profile: profile
      ? {
          targetExaminationSlug: profile.target_slug,
          targetExamination: profile.target_name,
          expectedExamDate: profile.expected_exam_date,
          dailyMinutes: profile.daily_minutes,
          paused: profile.plan_paused === 1,
          currentStreak: profile.current_streak,
        }
      : null,
    mastery,
    mistakes,
    plan,
    dueRevisionCount: mistakes.filter(
      (item) =>
        Reflect.get(item, 'revisionStatus') !== 'mastered' &&
        String(Reflect.get(item, 'nextReviewAt')) <= isoNow(),
    ).length,
    studyProgress: {
      ...learningCounts,
      completionPercent: studyCompletionPercent(
        learningCounts.completed,
        learningCounts.retryRequired,
        learningCounts.planned,
      ),
    },
  });
});

routes.post('/api/study/plan/generate', async (context) => {
  const body = z.object({ visitorUuid: z.uuid() }).safeParse(await context.req.json());
  if (!body.success) return context.json({ error: 'Valid anonymous visitor required.' }, 400);
  const visitor = await visitorFor(context.env.DB, body.data.visitorUuid);
  if (!visitor) return context.json({ error: 'Anonymous visitor not found.' }, 404);
  const profile = await profileFor(context.env.DB, visitor.visitor_number);
  if (!profile) return context.json({ error: 'Create a study profile first.' }, 409);
  if (profile.plan_paused) return context.json({ error: 'The study plan is paused.' }, 409);
  return context.json({ plan: await refreshPlan(context.env.DB, profile) });
});

routes.put('/api/study/plan/:id', zValidator('json', planItemUpdateSchema), async (context) => {
  const input = context.req.valid('json');
  const visitor = await visitorFor(context.env.DB, input.visitorUuid);
  if (!visitor) return context.json({ error: 'Anonymous visitor not found.' }, 404);
  const timestamp = isoNow();
  const result = await context.env.DB.prepare(
    `UPDATE study_plan_items SET status = ?, completed_at = ?
        WHERE id = ? AND visitor_number = ?`,
  )
    .bind(input.status, null, context.req.param('id'), visitor.visitor_number)
    .run();
  if (result.meta.changes === 0) return context.json({ error: 'Plan item not found.' }, 404);
  await context.env.DB.prepare(
    `INSERT INTO study_task_learning (plan_item_id,state,updated_at) VALUES (?,?,?)
    ON CONFLICT(plan_item_id) DO UPDATE SET state=excluded.state,updated_at=excluded.updated_at`,
  )
    .bind(
      context.req.param('id'),
      input.status === 'skipped' ? 'skipped' : 'not_started',
      timestamp,
    )
    .run();
  return context.json({ status: input.status });
});

routes.post('/api/study/plan/:id/open', async (context) => {
  const body = z.object({ visitorUuid: z.uuid() }).safeParse(await context.req.json());
  if (!body.success) return context.json({ error: 'Valid anonymous visitor required.' }, 400);
  const visitor = await visitorFor(context.env.DB, body.data.visitorUuid);
  if (!visitor) return context.json({ error: 'Anonymous visitor not found.' }, 404);
  const item = await context.env.DB.prepare(
    `SELECT p.id,p.subject,p.topic,p.rationale,sp.target_examination_id AS examId,
    n.title,n.summary_markdown AS summary FROM study_plan_items p JOIN study_profiles sp ON sp.visitor_number=p.visitor_number
    LEFT JOIN notes n ON n.examination_id=sp.target_examination_id AND n.verification_status='published'
      AND (p.subject IS NULL OR n.subject=p.subject) AND (p.topic IS NULL OR n.topic=p.topic)
    WHERE p.id=? AND p.visitor_number=? ORDER BY n.published_at DESC LIMIT 1`,
  )
    .bind(context.req.param('id'), visitor.visitor_number)
    .first<{
      id: string;
      subject: string | null;
      topic: string | null;
      rationale: string;
      examId: string | null;
      title: string | null;
      summary: string | null;
    }>();
  if (!item) return context.json({ error: 'Plan item not found.' }, 404);
  await context.env.DB.prepare(
    `INSERT INTO study_task_learning (plan_item_id,state,updated_at) VALUES (?,'reading',?)
    ON CONFLICT(plan_item_id) DO UPDATE SET state=CASE WHEN state='completed' THEN state ELSE 'reading' END,updated_at=excluded.updated_at`,
  )
    .bind(item.id, isoNow())
    .run();
  return context.json({
    state: 'reading',
    lesson: {
      title: item.title ?? `${item.topic ?? item.subject ?? 'Diagnostic foundations'} micro-lesson`,
      body:
        item.summary ??
        `Learning objective: ${item.rationale} Open the relevant concept, work through at least one example, and focus on why each step is valid before attempting the check.`,
      sourceStatus: item.summary ? 'verified_note' : 'plan_micro_lesson',
    },
  });
});

routes.post(
  '/api/study/plan/:id/engagement',
  zValidator('json', lessonEngagementSchema),
  async (context) => {
    const input = context.req.valid('json');
    const visitor = await visitorFor(context.env.DB, input.visitorUuid);
    if (!visitor) return context.json({ error: 'Anonymous visitor not found.' }, 404);
    const owned = await context.env.DB.prepare(
      'SELECT 1 AS owned FROM study_plan_items WHERE id=? AND visitor_number=?',
    )
      .bind(context.req.param('id'), visitor.visitor_number)
      .first();
    if (!owned) return context.json({ error: 'Plan item not found.' }, 404);
    const meaningful =
      input.visibleSeconds >= 10 && input.scrollPercent >= 50 && input.sectionsOpened >= 1;
    await context.env.DB.prepare(
      `INSERT INTO study_task_learning
    (plan_item_id,state,engaged_seconds,max_scroll_percent,visible_seconds,sections_opened,examples_interacted,updated_at)
    VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(plan_item_id) DO UPDATE SET state=?,engaged_seconds=MAX(engaged_seconds,excluded.engaged_seconds),
      max_scroll_percent=MAX(max_scroll_percent,excluded.max_scroll_percent),visible_seconds=MAX(visible_seconds,excluded.visible_seconds),
      sections_opened=MAX(sections_opened,excluded.sections_opened),examples_interacted=MAX(examples_interacted,excluded.examples_interacted),updated_at=excluded.updated_at`,
    )
      .bind(
        context.req.param('id'),
        meaningful ? 'check_required' : 'reading',
        input.engagedSeconds,
        input.scrollPercent,
        input.visibleSeconds,
        input.sectionsOpened,
        input.examplesInteracted,
        isoNow(),
        meaningful ? 'check_required' : 'reading',
      )
      .run();
    return context.json({
      state: meaningful ? 'check_required' : 'reading',
      message: meaningful
        ? 'Comprehension check unlocked.'
        : 'Continue engaging with the lesson before the check.',
    });
  },
);

routes.post('/api/study/plan/:id/checks', async (context) => {
  const body = z.object({ visitorUuid: z.uuid() }).safeParse(await context.req.json());
  if (!body.success) return context.json({ error: 'Valid anonymous visitor required.' }, 400);
  const visitor = await visitorFor(context.env.DB, body.data.visitorUuid);
  if (!visitor) return context.json({ error: 'Anonymous visitor not found.' }, 404);
  const item = await context.env.DB.prepare(
    `SELECT p.subject,p.topic,sp.target_examination_id AS examId,l.state,
    COALESCE(l.check_attempts,0) AS attempts FROM study_plan_items p JOIN study_profiles sp ON sp.visitor_number=p.visitor_number
    JOIN study_task_learning l ON l.plan_item_id=p.id WHERE p.id=? AND p.visitor_number=?`,
  )
    .bind(context.req.param('id'), visitor.visitor_number)
    .first<{
      subject: string | null;
      topic: string | null;
      examId: string | null;
      state: string;
      attempts: number;
    }>();
  if (!item || !['check_required', 'retry_required'].includes(item.state))
    return context.json(
      { error: 'Complete the lesson engagement step before starting a check.' },
      409,
    );
  const previousRows = await context.env.DB.prepare(
    'SELECT question_ids_json AS ids FROM study_comprehension_attempts WHERE plan_item_id=?',
  )
    .bind(context.req.param('id'))
    .all<{ ids: string }>();
  const excluded = new Set(previousRows.results.flatMap((row) => JSON.parse(row.ids) as string[]));
  const { results: candidates } = await context.env.DB.prepare(
    `SELECT q.id,q.question_text AS questionText,q.subject,q.topic
    FROM questions q WHERE q.examination_id=? AND q.verification_status='published'
      AND (? IS NULL OR q.subject=?) AND (? IS NULL OR q.topic=?)
    ORDER BY q.created_at DESC LIMIT 30`,
  )
    .bind(item.examId, item.subject, item.subject, item.topic, item.topic)
    .all<{ id: string; questionText: string; subject: string; topic: string }>();
  const selected = candidates
    .filter((question) => !excluded.has(question.id))
    .slice(0, Math.min(3, candidates.length));
  if (selected.length < 2)
    return context.json(
      {
        error:
          'Not enough different verified questions are available for this check. Reopen the lesson or choose focused AI practice.',
      },
      409,
    );
  const questions = await Promise.all(
    selected.map(async (question) => ({
      ...question,
      options: (
        await context.env.DB.prepare(
          'SELECT option_index AS optionIndex,option_text AS optionText FROM question_options WHERE question_id=? ORDER BY option_index',
        )
          .bind(question.id)
          .all()
      ).results,
    })),
  );
  const checkId = crypto.randomUUID();
  await context.env.DB.prepare(
    `INSERT INTO study_comprehension_attempts (id,plan_item_id,attempt_number,question_ids_json,created_at) VALUES (?,?,?,?,?)`,
  )
    .bind(
      checkId,
      context.req.param('id'),
      item.attempts + 1,
      JSON.stringify(selected.map((question) => question.id)),
      isoNow(),
    )
    .run();
  return context.json({ checkId, passingPercent: 70, questions });
});

routes.post(
  '/api/study/plan/:id/checks/submit',
  zValidator('json', comprehensionSubmitSchema),
  async (context) => {
    const input = context.req.valid('json');
    const visitor = await visitorFor(context.env.DB, input.visitorUuid);
    if (!visitor) return context.json({ error: 'Anonymous visitor not found.' }, 404);
    const check = await context.env.DB.prepare(
      `SELECT c.question_ids_json AS ids,c.submitted_at AS submittedAt FROM study_comprehension_attempts c
    JOIN study_plan_items p ON p.id=c.plan_item_id WHERE c.id=? AND c.plan_item_id=? AND p.visitor_number=?`,
    )
      .bind(input.checkId, context.req.param('id'), visitor.visitor_number)
      .first<{ ids: string; submittedAt: string | null }>();
    if (!check || check.submittedAt)
      return context.json({ error: 'Comprehension check not found or already submitted.' }, 409);
    const expected = JSON.parse(check.ids) as string[];
    if (
      input.answers.length !== expected.length ||
      input.answers.some((answer) => !expected.includes(answer.questionId))
    )
      return context.json({ error: 'Answers do not match this check.' }, 400);
    const feedback = await Promise.all(
      input.answers.map(async (answer) => {
        const key = await context.env.DB.prepare(
          `SELECT k.correct_option_index AS correctOptionIndex,k.explanation FROM answer_key_versions k
      WHERE k.question_id=? AND k.is_current=1 ORDER BY k.created_at DESC LIMIT 1`,
        )
          .bind(answer.questionId)
          .first<{ correctOptionIndex: number; explanation: string | null }>();
        return {
          questionId: answer.questionId,
          correct: answer.selectedOptionIndex === key?.correctOptionIndex,
          correctOptionIndex: key?.correctOptionIndex,
          explanation: key?.explanation ?? 'Review the verified lesson and solution.',
        };
      }),
    );
    const correct = feedback.filter((item) => item.correct).length;
    const scorePercent = Math.round((correct / feedback.length) * 100);
    const passed = scorePercent >= 70;
    const timestamp = isoNow();
    const statements = [
      context.env.DB.prepare(
        'UPDATE study_comprehension_attempts SET answers_json=?,score_percent=?,passed=?,submitted_at=? WHERE id=?',
      ).bind(JSON.stringify(input.answers), scorePercent, passed ? 1 : 0, timestamp, input.checkId),
      context.env.DB.prepare(
        `UPDATE study_task_learning SET state=?,check_attempts=check_attempts+1,correct_answers=correct_answers+?,total_answers=total_answers+?,completed_at=?,updated_at=? WHERE plan_item_id=?`,
      ).bind(
        passed ? 'completed' : 'retry_required',
        correct,
        feedback.length,
        passed ? timestamp : null,
        timestamp,
        context.req.param('id'),
      ),
    ];
    if (passed) {
      statements.push(
        context.env.DB.prepare(
          `UPDATE study_plan_items SET status='completed',completed_at=? WHERE id=?`,
        ).bind(timestamp, context.req.param('id')),
        ...[1, 3, 7, 15].map((days) =>
          context.env.DB.prepare(
            `INSERT INTO study_revisions (id,plan_item_id,due_at,interval_days,status) VALUES (?,?,datetime(?, '+' || ? || ' days'),?,'scheduled')`,
          ).bind(crypto.randomUUID(), context.req.param('id'), timestamp, days, days),
        ),
        context.env.DB.prepare(
          `UPDATE study_profiles SET current_streak=CASE WHEN last_study_date=date(?,'-1 day') THEN current_streak+1 WHEN last_study_date=date(?) THEN current_streak ELSE 1 END,last_study_date=date(?),updated_at=? WHERE visitor_number=?`,
        ).bind(timestamp, timestamp, timestamp, timestamp, visitor.visitor_number),
      );
    }
    await context.env.DB.batch(statements);
    return context.json({
      passed,
      scorePercent,
      state: passed ? 'completed' : 'retry_required',
      feedback,
      nextAction: passed
        ? 'Revisions scheduled for 1, 3, 7 and 15 days.'
        : 'Reopen the lesson, review a simpler explanation, then try a different check.',
    });
  },
);

routes.put(
  '/api/study/mistakes/:questionId',
  zValidator('json', mistakeUpdateSchema),
  async (context) => {
    const input = context.req.valid('json');
    const visitor = await visitorFor(context.env.DB, input.visitorUuid);
    if (!visitor) return context.json({ error: 'Anonymous visitor not found.' }, 404);
    const result = await context.env.DB.prepare(
      `UPDATE mistake_notebook
          SET mistake_reason = COALESCE(?, mistake_reason),
              bookmarked = COALESCE(?, bookmarked), updated_at = ?
        WHERE visitor_number = ? AND question_id = ?`,
    )
      .bind(
        input.mistakeReason ?? null,
        input.bookmarked === undefined ? null : input.bookmarked ? 1 : 0,
        isoNow(),
        visitor.visitor_number,
        context.req.param('questionId'),
      )
      .run();
    if (result.meta.changes === 0 && input.bookmarked) {
      const recent = await context.env.DB.prepare(
        `SELECT a.id FROM attempts a
          JOIN attempt_questions aq ON aq.attempt_id = a.id
         WHERE a.visitor_number = ? AND aq.question_id = ?
         ORDER BY a.created_at DESC LIMIT 1`,
      )
        .bind(visitor.visitor_number, context.req.param('questionId'))
        .first<{ id: string }>();
      if (!recent) return context.json({ error: 'Attempt question not found.' }, 404);
      const timestamp = isoNow();
      const nextAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      await context.env.DB.prepare(
        `INSERT INTO mistake_notebook
           (visitor_number, question_id, attempt_id, source_outcome, revision_status,
            interval_days, review_count, next_review_at, bookmarked, created_at, updated_at)
         VALUES (?, ?, ?, 'bookmarked', 'scheduled', 1, 0, ?, 1, ?, ?)`,
      )
        .bind(
          visitor.visitor_number,
          context.req.param('questionId'),
          recent.id,
          nextAt,
          timestamp,
          timestamp,
        )
        .run();
    } else if (result.meta.changes === 0) {
      return context.json({ error: 'Notebook item not found.' }, 404);
    }
    return context.json({ status: 'saved' });
  },
);

routes.post(
  '/api/study/revisions/:questionId',
  zValidator('json', revisionReviewSchema),
  async (context) => {
    const input = context.req.valid('json');
    const visitor = await visitorFor(context.env.DB, input.visitorUuid);
    if (!visitor) return context.json({ error: 'Anonymous visitor not found.' }, 404);
    const current = await context.env.DB.prepare(
      `SELECT interval_days FROM mistake_notebook
        WHERE visitor_number = ? AND question_id = ?`,
    )
      .bind(visitor.visitor_number, context.req.param('questionId'))
      .first<{ interval_days: number }>();
    if (!current) return context.json({ error: 'Notebook item not found.' }, 404);
    const schedule = nextRevision(current.interval_days, input.correct, input.confidence);
    const timestamp = isoNow();
    const nextAt = new Date(Date.now() + schedule.intervalDays * 24 * 60 * 60 * 1000).toISOString();
    await context.env.DB.prepare(
      `UPDATE mistake_notebook
          SET confidence = ?, interval_days = ?, revision_status = ?,
              review_count = review_count + 1, last_reviewed_at = ?,
              next_review_at = ?, updated_at = ?
        WHERE visitor_number = ? AND question_id = ?`,
    )
      .bind(
        input.confidence,
        schedule.intervalDays,
        schedule.status,
        timestamp,
        nextAt,
        timestamp,
        visitor.visitor_number,
        context.req.param('questionId'),
      )
      .run();
    return context.json({ ...schedule, nextReviewAt: nextAt });
  },
);

routes.get('/api/intelligence/:examinationSlug', async (context) => {
  const examination = await context.env.DB.prepare(
    'SELECT id FROM examinations WHERE slug = ? AND enabled = 1',
  )
    .bind(context.req.param('examinationSlug'))
    .first<{ id: string }>();
  if (!examination) return context.json({ error: 'Examination not found.' }, 404);
  const { results } = await context.env.DB.prepare(
    `SELECT q.subject, q.topic, q.year, q.difficulty, COUNT(*) AS questionCount
       FROM questions q
      WHERE q.examination_id = ? AND q.content_origin = 'official_pyq'
        AND q.verification_status = 'published'
      GROUP BY q.subject, q.topic, q.year, q.difficulty
      ORDER BY questionCount DESC, q.year DESC`,
  )
    .bind(examination.id)
    .all();
  const total = results.reduce((sum, row) => sum + Number(Reflect.get(row, 'questionCount')), 0);
  return context.json({
    available: total >= 20,
    verifiedQuestionCount: total,
    minimumRequired: 20,
    trends: total >= 20 ? results : [],
    disclaimer: 'Historical verified PYQ trends do not guarantee future questions.',
  });
});

routes.get('/api/current-affairs', async (context) => {
  const { results } = await context.env.DB.prepare(
    `SELECT id, headline, summary, topic, examination_relevance_json AS examinationRelevance,
            language, source_url AS sourceUrl, source_title AS sourceTitle,
            published_on AS publishedOn, verified_at AS verifiedAt
       FROM current_affairs WHERE verification_status = 'published'
      ORDER BY published_on DESC LIMIT 60`,
  ).all();
  return context.json({ entries: results });
});

routes.get('/api/exam-calendar', async (context) => {
  const { results } = await context.env.DB.prepare(
    `SELECT ce.id, e.short_name AS examination, e.slug AS examinationSlug,
            ce.event_type AS eventType, ce.title, ce.starts_on AS startsOn,
            ce.ends_on AS endsOn, ce.source_url AS sourceUrl, ce.verified_at AS verifiedAt
       FROM exam_calendar_events ce
       JOIN examinations e ON e.id = ce.examination_id
      WHERE ce.verification_status = 'verified_official'
      ORDER BY ce.starts_on LIMIT 100`,
  ).all();
  return context.json({ events: results });
});

const groqResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().optional(),
      completion_tokens: z.number().int().optional(),
    })
    .optional(),
});

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, '0')).join('');
}

routes.post('/api/doubts', zValidator('json', doubtRequestSchema), async (context) => {
  const input = context.req.valid('json');
  const visitor = await visitorFor(context.env.DB, input.visitorUuid);
  if (!visitor) return context.json({ error: 'Anonymous visitor not found.' }, 404);
  const variables = validateRuntimeEnvironment(context.env);
  if (!(await verifyTurnstile(input.turnstileToken, variables)))
    return context.json({ error: 'Human verification was not completed.' }, 403);

  const grounding = await context.env.DB.prepare(
    `SELECT q.question_text AS questionText, q.explanation_markdown AS explanation,
              s.source_url AS sourceUrl,
              (SELECT n.summary_markdown FROM note_related_questions nr
                JOIN notes n ON n.id = nr.note_id
               WHERE nr.question_id = q.id AND n.verification_status = 'published'
               ORDER BY n.published_at DESC LIMIT 1) AS noteSummary
         FROM questions q
         JOIN source_documents d ON d.id = q.document_id
         JOIN official_sources s ON s.id = d.source_id
        WHERE q.id = ? AND q.verification_status = 'published'`,
  )
    .bind(input.questionId)
    .first<{
      questionText: string;
      explanation: string | null;
      sourceUrl: string;
      noteSummary: string | null;
    }>();
  if (!grounding || (!grounding.explanation && !grounding.noteSummary)) {
    return context.json({
      status: 'insufficient_verified_material',
      answer: 'Verified material is insufficient to answer this doubt.',
      sources: [],
    });
  }

  const minute = isoNow().slice(0, 16);
  const day = today();
  const rateKeys = [
    [`ai:minute:${String(visitor.visitor_number)}:${minute}`, 3, 120],
    [`ai:day:${String(visitor.visitor_number)}:${day}`, 10, 172800],
    [`ai:global:${day}`, 100, 172800],
  ] as const;
  for (const [key, maximum] of rateKeys) {
    if (Number((await context.env.PUBLIC_CACHE.get(key)) ?? '0') >= maximum)
      return context.json({ error: 'The doubt allowance is exhausted for now.' }, 429);
  }
  await Promise.all(
    rateKeys.map(async ([key, , ttl]) => {
      const count = Number((await context.env.PUBLIC_CACHE.get(key)) ?? '0');
      await context.env.PUBLIC_CACHE.put(key, String(count + 1), { expirationTtl: ttl });
    }),
  );

  const cacheKey = `ai:answer:${await sha256(`${input.questionId}:${input.question.toLowerCase()}`)}`;
  const cached = await context.env.PUBLIC_CACHE.get(cacheKey, 'json');
  if (cached) return context.json(cached);

  const { GROQ_ENABLED: enabled, GROQ_API_KEY: apiKey, GROQ_MODEL: model } = variables;
  const fallback = {
    status: 'verified_fallback',
    answer: grounding.explanation ?? grounding.noteSummary,
    sources: [{ title: 'Verified source material', url: grounding.sourceUrl }],
    aiGenerated: false,
  };
  if (enabled !== 'on' || !apiKey) {
    await context.env.DB.prepare(
      `INSERT INTO ai_usage_logs (id, visitor_number, feature, status, created_at)
         VALUES (?, ?, 'grounded_doubt', 'fallback', ?)`,
    )
      .bind(crypto.randomUUID(), visitor.visitor_number, isoNow())
      .run();
    return context.json(fallback);
  }

  const modelCooldown = await context.env.DB.prepare(
    `SELECT cooldown_until FROM ai_provider_model_cooldowns
      WHERE model=? AND cooldown_until>?`,
  )
    .bind(model, isoNow())
    .first<{ cooldown_until: string }>();
  if (modelCooldown) return context.json(fallback);

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, 8_000);
  let providerLock: string | null = null;
  try {
    providerLock = await acquireProviderGate(
      context.env.DB,
      `doubt:${String(visitor.visitor_number)}:${input.questionId}`,
      model,
      'verification',
      variables.AI_PROVIDER_MIN_INTERVAL_MS,
    );
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_completion_tokens: 500,
        messages: [
          {
            role: 'system',
            content:
              'Answer only from the supplied verified context. If it is insufficient, say so. Do not predict qualification, invent sources, or reveal hidden reasoning.',
          },
          {
            role: 'user',
            content: `Question: ${grounding.questionText}\nVerified explanation: ${grounding.explanation ?? 'None'}\nApproved note: ${grounding.noteSummary ?? 'None'}\nLearner doubt: ${input.question}`,
          },
        ],
      }),
      signal: controller.signal,
    });
    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('retry-after'));
      await recordProviderCooldown(context.env.DB, model, retryAfterSeconds, response.status);
    }
    if (!response.ok) {
      console.log(
        JSON.stringify({
          event: 'ai_provider_request',
          attemptId: `doubt:${input.questionId}`,
          stage: 'grounded_doubt',
          model,
          inputTokens: 0,
          outputTokens: 0,
          batchSize: 1,
          responseStatus: response.status,
          fallbackDecision: 'primary',
        }),
      );
      throw new Error(`Groq returned ${String(response.status)}.`);
    }
    const parsed = groqResponseSchema.parse(await response.json());
    console.log(
      JSON.stringify({
        event: 'ai_provider_request',
        attemptId: `doubt:${input.questionId}`,
        stage: 'grounded_doubt',
        model,
        inputTokens: parsed.usage?.prompt_tokens ?? 0,
        outputTokens: parsed.usage?.completion_tokens ?? 0,
        batchSize: 1,
        responseStatus: response.status,
        fallbackDecision: 'primary',
      }),
    );
    const result = {
      status: 'answered',
      answer: parsed.choices[0]?.message.content ?? fallback.answer,
      sources: fallback.sources,
      aiGenerated: true,
    };
    await context.env.PUBLIC_CACHE.put(cacheKey, JSON.stringify(result), {
      expirationTtl: 86400,
    });
    await context.env.DB.prepare(
      `INSERT INTO ai_usage_logs
           (id, visitor_number, feature, model, status, input_tokens, output_tokens, created_at)
         VALUES (?, ?, 'grounded_doubt', ?, 'served', ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        visitor.visitor_number,
        model,
        parsed.usage?.prompt_tokens ?? null,
        parsed.usage?.completion_tokens ?? null,
        isoNow(),
      )
      .run();
    return context.json(result);
  } catch {
    await context.env.DB.prepare(
      `INSERT INTO ai_usage_logs
           (id, visitor_number, feature, model, status, created_at)
         VALUES (?, ?, 'grounded_doubt', ?, 'failed', ?)`,
    )
      .bind(crypto.randomUUID(), visitor.visitor_number, model, isoNow())
      .run();
    return context.json(fallback);
  } finally {
    clearTimeout(timeout);
    if (providerLock)
      await releaseProviderGate(
        context.env.DB,
        providerLock,
        variables.AI_PROVIDER_MIN_INTERVAL_MS,
      );
  }
});

export { routes as phaseFiveRoutes };
