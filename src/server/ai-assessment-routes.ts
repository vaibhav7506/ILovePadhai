import { zValidator } from '@hono/zod-validator';
import {
  aiExamConfigurations,
  aiTestRequestSchema,
  buildGenerationPrompt,
  deterministicQuestionIssues,
  deterministicArithmeticAnswer,
  examConfiguration,
  generatedBatchSchema,
  normaliseQuestion,
  optionIndependentText,
  sha256,
  tokenSimilarity,
  verificationBatchSchema,
  type AiTestRequest,
  type GeneratedQuestion,
} from '@shared/ai-assessment';
import { signAttemptToken } from '@shared/attempt-token';
import { Hono } from 'hono';
import { authorizedAttempt } from './attempt-routes';
import { validateRuntimeEnvironment } from './env';
import { verifyTurnstile } from './turnstile';

interface AiEnvironment { Bindings: Env }
interface GroqUsage { prompt_tokens?: number; completion_tokens?: number }
interface GroqResponse { choices?: Array<{ message?: { content?: string } }>; usage?: GroqUsage }

const routes = new Hono<AiEnvironment>();
const stageLabels: Record<string, string> = {
  pending: 'Preparing examination pattern',
  preparing: 'Preparing examination pattern',
  generating: 'Generating questions',
  deduplicating: 'Checking duplicates',
  verifying: 'Verifying answers',
  ready: 'Test ready',
  failed: 'Generation failed',
};

function signingSecret(env: Env): string | null {
  const value: unknown = Reflect.get(env, 'ATTEMPT_SIGNING_SECRET');
  return typeof value === 'string' && value.length >= 32 ? value : null;
}

async function groqJson(env: Env, system: string, user: string): Promise<{ value: unknown; usage: GroqUsage }> {
  const variables = validateRuntimeEnvironment(env);
  if (variables.GROQ_ENABLED !== 'on' || !variables.GROQ_API_KEY) throw new Error('AI practice is temporarily unavailable.');
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${variables.GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: variables.GROQ_MODEL,
      temperature: 0.55,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`AI provider returned ${String(response.status)}.`);
  const payload = (await response.json()) as GroqResponse;
  const content = payload.choices?.[0]?.message?.content;
  if (!content) throw new Error('AI provider returned no structured content.');
  return { value: JSON.parse(content) as unknown, usage: payload.usage ?? {} };
}

async function updateStage(db: D1Database, attemptId: string, stage: string): Promise<void> {
  const at = new Date().toISOString();
  await db.batch([
    db.prepare('UPDATE attempts SET generation_status = ? WHERE id = ?').bind(stage, attemptId),
    db.prepare('UPDATE generation_runs SET stage = ?, status = ?, started_at = COALESCE(started_at, ?) WHERE attempt_id = ?')
      .bind(stage, stage === 'ready' ? 'completed' : 'running', at, attemptId),
  ]);
}

async function requestFingerprint(request: AiTestRequest): Promise<string> {
  return sha256(JSON.stringify({ ...request, visitorUuid: undefined, nickname: undefined, turnstileToken: undefined }));
}

routes.get('/api/ai/config', (context) => context.json({
  examinations: aiExamConfigurations,
  questionCounts: [5, 10, 15, 20, 25, 50],
  stages: Object.values(stageLabels).slice(0, 5),
  similarityThreshold: 0.78,
}));

routes.post('/api/ai/attempts', zValidator('json', aiTestRequestSchema), async (context) => {
  const variables = validateRuntimeEnvironment(context.env);
  const secret = signingSecret(context.env);
  if (!secret || variables.GROQ_ENABLED !== 'on' || variables.AI_GENERATION_ENABLED !== 'on') return context.json({ error: 'AI practice is temporarily unavailable. Existing results and study tools remain available.' }, 503);
  const input = context.req.valid('json');
  if (!(await verifyTurnstile(input.turnstileToken, variables))) return context.json({ error: 'Human verification was not completed.' }, 403);
  const config = examConfiguration(input.examinationSlug);
  if (!config || !config.tiers.includes(input.tierStage)) return context.json({ error: 'Unsupported examination configuration.' }, 400);
  if (input.subject !== 'All subjects' && !Object.hasOwn(config.subjects, input.subject)) return context.json({ error: 'Subject is outside this examination syllabus.' }, 400);
  const visitor = await context.env.DB.prepare('SELECT visitor_number FROM anonymous_visitors WHERE visitor_uuid = ?').bind(input.visitorUuid).first<{ visitor_number: number }>();
  if (!visitor) return context.json({ error: 'Anonymous visitor not found.' }, 404);
  const day = new Date().toISOString().slice(0, 10);
  const visitorKey = `ai:visitor:${visitor.visitor_number}:${day}`;
  const globalKey = `ai:global:${day}`;
  const [visitorCount, globalCount] = await Promise.all([context.env.PUBLIC_CACHE.get(visitorKey), context.env.PUBLIC_CACHE.get(globalKey)]);
  const perVisitorLimit = variables.AI_VISITOR_DAILY_LIMIT;
  const globalLimit = variables.AI_GLOBAL_DAILY_REQUEST_LIMIT;
  if (Number(visitorCount ?? 0) >= perVisitorLimit || Number(globalCount ?? 0) >= globalLimit) return context.json({ error: 'AI practice is temporarily unavailable because today’s generation limit was reached.' }, 429);
  const examination = await context.env.DB.prepare('SELECT id FROM examinations WHERE slug = ? AND enabled = 1').bind(config.slug).first<{ id: string }>();
  if (!examination) return context.json({ error: 'Examination not found.' }, 404);
  const requestedCount = input.fullMock ? config.standardQuestions : (input.questionCount ?? 10);
  const durationSeconds = input.timerMode === 'untimed' ? 24 * 60 * 60 : (input.fullMock || input.timerMode === 'standard' ? config.standardDurationMinutes : (input.customDurationMinutes ?? 10)) * 60;
  const id = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const placeholderExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const fingerprint = await requestFingerprint(input);
  const activeKey = `${visitor.visitor_number}:${fingerprint}`;
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(`INSERT INTO attempts
        (id,visitor_number,examination_id,pattern_id,mode,tier_stage,nickname,category,region,post_name,stage_name,selection_json,comparison_key,status,question_count,duration_seconds,started_at,expires_at,created_at,generation_status)
        VALUES (?,?,?,NULL,'custom',?,?,?,?,?,?,?,NULL,'active',?,?,?, ?,?,'pending')`)
        .bind(id, visitor.visitor_number, examination.id, input.tierStage, input.nickname ?? null, input.category ?? null, input.region ?? null, input.post ?? null, input.tierStage, JSON.stringify(input), requestedCount, durationSeconds, createdAt, placeholderExpiry, createdAt),
      context.env.DB.prepare(`INSERT INTO generation_runs
        (id,attempt_id,visitor_number,request_fingerprint,active_key,stage,status,requested_count,created_at)
        VALUES (?,?,?,?,?,'pending','pending',?,?)`).bind(runId, id, visitor.visitor_number, fingerprint, activeKey, requestedCount, createdAt),
    ]);
  } catch {
    return context.json({ error: 'An identical generation request is already running.' }, 409);
  }
  await Promise.all([
    context.env.PUBLIC_CACHE.put(visitorKey, String(Number(visitorCount ?? 0) + 1), { expirationTtl: 172800 }),
    context.env.PUBLIC_CACHE.put(globalKey, String(Number(globalCount ?? 0) + 1), { expirationTtl: 172800 }),
  ]);
  const token = await signAttemptToken({ attemptId: id, visitorNumber: visitor.visitor_number, issuedAt: Math.floor(Date.now() / 1000), nonce: crypto.randomUUID() }, secret);
  return context.json({ attemptId: id, attemptToken: token, generationStatus: 'pending', stage: stageLabels.pending }, 202);
});

routes.get('/api/ai/attempts/:id/generation', async (context) => {
  const attempt = await authorizedAttempt(context.req.raw, context.env, context.req.param('id'));
  if (!attempt) return context.json({ error: 'Attempt not found.' }, 404);
  const run = await context.env.DB.prepare(`SELECT stage,status,requested_count AS requestedCount,accepted_count AS acceptedCount,rejected_count AS rejectedCount,error_summary AS error FROM generation_runs WHERE attempt_id = ?`).bind(attempt.id).first<Record<string, unknown> & { stage: string }>();
  return context.json({ ...run, stageLabel: stageLabels[run?.stage ?? 'pending'] ?? 'Preparing examination pattern' });
});

routes.post('/api/ai/attempts/:id/generate', async (context) => {
  const attempt = await authorizedAttempt(context.req.raw, context.env, context.req.param('id'));
  if (!attempt) return context.json({ error: 'Attempt not found.' }, 404);
  const row = await context.env.DB.prepare('SELECT selection_json,generation_status,question_count,duration_seconds,examination_id FROM attempts WHERE id = ?').bind(attempt.id).first<{ selection_json: string; generation_status: string; question_count: number; duration_seconds: number; examination_id: string }>();
  if (!row || row.generation_status !== 'pending') return context.json({ error: row?.generation_status === 'ready' ? 'Test is already ready.' : 'Generation cannot be started.' }, 409);
  const request = aiTestRequestSchema.parse(JSON.parse(row.selection_json));
  const config = examConfiguration(request.examinationSlug);
  if (!config) return context.json({ error: 'Unsupported examination.' }, 400);
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const accepted: GeneratedQuestion[] = [];
  const acceptedExact = new Set<string>();
  let rejectedCount = 0;
  try {
    await updateStage(context.env.DB, attempt.id, 'preparing');
    const { results: history } = await context.env.DB.prepare(`SELECT f.exact_sha256 AS exact, q.question_text AS text FROM question_fingerprints f JOIN questions q ON q.id=f.question_id LEFT JOIN visitor_question_history h ON h.question_id=q.id WHERE h.visitor_number=? OR f.created_at >= datetime('now','-30 days') ORDER BY f.created_at DESC LIMIT 600`).bind(attempt.visitor_number).all<{ exact: string; text: string }>();
    const excluded = history.map((item) => item.exact);
    for (let round = 0; round < 4 && accepted.length < row.question_count; round += 1) {
      await updateStage(context.env.DB, attempt.id, 'generating');
      const needed = row.question_count - accepted.length;
      const generated = await groqJson(context.env, `You are the ${config.name} assessment author. Obey the exam-specific version and output JSON only.`, buildGenerationPrompt(config, request, needed, excluded, crypto.randomUUID()));
      totalInputTokens += generated.usage.prompt_tokens ?? 0;
      totalOutputTokens += generated.usage.completion_tokens ?? 0;
      const batch = generatedBatchSchema.parse(generated.value);
      await updateStage(context.env.DB, attempt.id, 'deduplicating');
      const candidates: GeneratedQuestion[] = [];
      for (const question of batch.questions) {
        if (accepted.length + candidates.length >= row.question_count) break;
        const exact = await sha256(normaliseQuestion(question.question));
        const optionHash = await sha256(optionIndependentText(question));
        const duplicate = acceptedExact.has(exact) || history.some((item) => item.exact === exact || tokenSimilarity(item.text, question.question) >= 0.78) || [...accepted, ...candidates].some((item) => optionIndependentText(item) === optionIndependentText(question) || tokenSimilarity(item.question, question.question) >= 0.78);
        if (duplicate || deterministicQuestionIssues(question).length > 0) { rejectedCount += 1; excluded.push(exact, optionHash); continue; }
        candidates.push(question);
      }
      if (candidates.length === 0) continue;
      await updateStage(context.env.DB, attempt.id, 'verifying');
      const verification = await groqJson(context.env, 'You are an independent assessment verifier, not the author. Reject ambiguity, incorrect keys, weak explanations, syllabus drift, unstable facts, missing context, and unsafe content. Return JSON only.', JSON.stringify({ exam: config.name, tier: request.tierStage, subject: request.subject, questions: candidates.map((question, index) => ({ index, question: question.question, options: question.options, proposedCorrectOptionIndex: question.correctOptionIndex, proposedExplanation: question.explanation, topic: question.topic })) }));
      totalInputTokens += verification.usage.prompt_tokens ?? 0;
      totalOutputTokens += verification.usage.completion_tokens ?? 0;
      const reviews = verificationBatchSchema.parse(verification.value);
      for (const question of candidates) {
        const index = candidates.indexOf(question);
        const review = reviews.results.find((item) => item.index === index);
        const deterministic = deterministicArithmeticAnswer(question);
        const acceptedReview = review && review.correctOptionIndex === question.correctOptionIndex &&
          ((review.status === 'verified' && review.confidence >= 0.8) ||
            (review.status === 'needs_deterministic_check' && deterministic === true));
        if (!acceptedReview || deterministic === false) { rejectedCount += 1; excluded.push(await sha256(normaliseQuestion(question.question))); continue; }
        accepted.push(question);
        acceptedExact.add(await sha256(normaliseQuestion(question.question)));
      }
    }
    if (accepted.length !== row.question_count) throw new Error('The unique-question pool for this selection is exhausted. Try another topic, difficulty, or examination.');
    const run = await context.env.DB.prepare('SELECT id FROM generation_runs WHERE attempt_id = ?').bind(attempt.id).first<{ id: string }>();
    if (!run) throw new Error('Generation run not found.');
    const createdAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < accepted.length; index += 1) {
      const question = accepted[index]!;
      const questionId = crypto.randomUUID();
      const exact = await sha256(normaliseQuestion(question.question));
      const stem = await sha256(normaliseQuestion(question.question).replace(/\b\d+(?:\.\d+)?\b/g, '#'));
      const optionHash = await sha256(optionIndependentText(question));
      const difficulty = question.difficulty === 'medium' ? 'moderate' : question.difficulty;
      statements.push(
        context.env.DB.prepare(`INSERT INTO questions (id,document_id,examination_id,qualification_level,tier_stage,year,section,subject,topic,difficulty,question_type,question_text,positive_marks,negative_marks,source_page,language,content_origin,verification_status,content_hash,reviewer_ref,last_verified_at,published_at,created_at) VALUES (?,'document-examforge-ai',?,?,?,?,2026,?,?,?,?, 'single_choice_mcq',?,?,?,?,?,'ai_generated_practice','published',?,'ai-independent-verifier',?,?,?)`).bind(questionId, row.examination_id, config.level, request.tierStage, question.subject, question.subject, question.topic, difficulty, question.question, config.positiveMarks, config.negativeMarks, 1, question.language, exact, createdAt, createdAt, createdAt),
        ...question.options.map((option, optionIndex) => context.env.DB.prepare('INSERT INTO question_options (id,question_id,option_index,option_text) VALUES (?,?,?,?)').bind(crypto.randomUUID(), questionId, optionIndex, option)),
        context.env.DB.prepare(`INSERT INTO answer_key_versions (id,question_id,source_id,key_type,correct_option_index,explanation,verification_status,is_current,effective_from,created_at) VALUES (?,?,'source-examforge-ai','editorial',?,?,'verified_editorial',1,?,?)`).bind(crypto.randomUUID(), questionId, question.correctOptionIndex, question.explanation, createdAt, createdAt),
        context.env.DB.prepare(`INSERT INTO generated_questions (question_id,generation_run_id,prompt_version,explanation,verification_status,verification_confidence,verification_reason,created_at) VALUES (?,?,?,?,'verified',0.8,'Independent model verification passed.',?)`).bind(questionId, run.id, config.promptVersion, question.explanation, createdAt),
        context.env.DB.prepare('INSERT INTO question_fingerprints (question_id,exact_sha256,stem_sha256,option_order_independent_sha256,normalised_tokens,concept_key,created_at) VALUES (?,?,?,?,?,?,?)').bind(questionId, exact, stem, optionHash, normaliseQuestion(question.question), `${config.slug}:${question.subject}:${question.topic}`, createdAt),
        context.env.DB.prepare(`INSERT INTO visitor_question_history (visitor_number,question_id,exact_sha256,shown_at,mode) VALUES (?,?,?,?,'ai_test')`).bind(attempt.visitor_number, questionId, exact, createdAt),
        context.env.DB.prepare('INSERT INTO attempt_questions (attempt_id,question_id,position,section,subject,topic,difficulty,positive_marks,negative_marks) VALUES (?,?,?,?,?,?,?,?,?)').bind(attempt.id, questionId, index + 1, question.subject, question.subject, question.topic, difficulty, config.positiveMarks, config.negativeMarks),
        context.env.DB.prepare('INSERT INTO attempt_responses (attempt_id,question_id,selected_option_index,marked_for_review,visited,client_elapsed_seconds,client_revision) VALUES (?,?,NULL,0,0,0,0)').bind(attempt.id, questionId),
      );
    }
    const comparable = await sha256(JSON.stringify({ exam: config.slug, tier: request.tierStage, count: row.question_count, difficulty: request.difficulty, subject: request.subject, duration: row.duration_seconds, positive: config.positiveMarks, negative: config.negativeMarks, version: config.promptVersion }));
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + row.duration_seconds * 1000);
    statements.push(
      context.env.DB.prepare(`UPDATE attempts SET generation_status='ready',comparison_key=?,started_at=?,expires_at=? WHERE id=?`).bind(comparable, startedAt.toISOString(), expiresAt.toISOString(), attempt.id),
      context.env.DB.prepare(`UPDATE generation_runs SET active_key=NULL,stage='ready',status='completed',accepted_count=?,rejected_count=?,input_tokens=?,output_tokens=?,estimated_cost_usd=?,completed_at=? WHERE attempt_id=?`).bind(accepted.length, rejectedCount, totalInputTokens, totalOutputTokens, Number(((totalInputTokens * 0.00000059) + (totalOutputTokens * 0.00000079)).toFixed(6)), createdAt, attempt.id),
      context.env.DB.prepare(`INSERT INTO ai_usage_logs (id,visitor_number,feature,model,status,input_tokens,output_tokens,created_at) VALUES (?,?, 'test_generation',?,'served',?,?,?)`).bind(crypto.randomUUID(), attempt.visitor_number, validateRuntimeEnvironment(context.env).GROQ_MODEL, totalInputTokens, totalOutputTokens, createdAt),
    );
    await context.env.DB.batch(statements);
    return context.json({ attemptId: attempt.id, questionCount: accepted.length, durationSeconds: row.duration_seconds, startedAt: startedAt.toISOString(), expiresAt: expiresAt.toISOString(), generationStatus: 'ready', stage: stageLabels.ready });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Generation failed.';
    await context.env.DB.batch([
      context.env.DB.prepare(`UPDATE attempts SET generation_status='failed',generation_error=?,status='abandoned' WHERE id=?`).bind(message, attempt.id),
      context.env.DB.prepare(`UPDATE generation_runs SET active_key=NULL,stage='failed',status=?,rejected_count=?,input_tokens=?,output_tokens=?,error_summary=?,completed_at=? WHERE attempt_id=?`).bind(message.includes('exhausted') ? 'exhausted' : 'failed', rejectedCount, totalInputTokens, totalOutputTokens, message, new Date().toISOString(), attempt.id),
      context.env.DB.prepare(`INSERT INTO ai_usage_logs (id,visitor_number,feature,model,status,input_tokens,output_tokens,created_at) VALUES (?,?, 'test_generation',?,'failed',?,?,?)`).bind(crypto.randomUUID(), attempt.visitor_number, validateRuntimeEnvironment(context.env).GROQ_MODEL, totalInputTokens, totalOutputTokens, new Date().toISOString()),
    ]);
    return context.json({ error: message }, message.includes('exhausted') ? 409 : 503);
  }
});

export { routes as aiAssessmentRoutes };
