import { zValidator } from '@hono/zod-validator';
import {
  aiExamConfigurations,
  aiTestRequestSchema,
  buildGenerationPrompt,
  compactVerificationPayload,
  deterministicQuestionIssues,
  decideGenerationAction,
  deterministicArithmeticAnswer,
  examConfiguration,
  generatedBatchSchema,
  generatedQuestionSchema,
  generationBatchSize,
  generationResponseJsonSchema,
  groqGenerationFallbackModels,
  groqMaxTokens,
  normaliseQuestion,
  optionIndependentText,
  parseGenerationContent,
  parseRetryAfterSeconds,
  parseVerificationContent,
  requireVerificationCoverage,
  selectAvailableGroqModel,
  sha256,
  tokenSimilarity,
  verificationResponseJsonSchema,
  type AiTestRequest,
  type GeneratedQuestion,
  type GenerationRunStateName,
  type GenerationWorkStage,
  type VerificationBatch,
} from '@shared/ai-assessment';
import { signAttemptToken } from '@shared/attempt-token';
import { Hono } from 'hono';
import { z } from 'zod';
import { authorizedAttempt } from './attempt-routes';
import { validateRuntimeEnvironment } from './env';
import { verifyTurnstile } from './turnstile';

interface AiEnvironment {
  Bindings: Env;
}
interface GroqUsage {
  prompt_tokens?: number | undefined;
  completion_tokens?: number | undefined;
}
const groqResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().optional(),
      completion_tokens: z.number().int().optional(),
    })
    .optional(),
});
type AiResponseStage = 'generation' | 'verification';

class AiResponseInvalidError extends Error {
  readonly code = 'AI_RESPONSE_INVALID';

  constructor(
    readonly stage: AiResponseStage,
    message = 'AI provider returned invalid structured data.',
  ) {
    super(message);
    this.name = 'AiResponseInvalidError';
  }
}

class AiProviderResponseError extends Error {
  constructor(readonly status: number) {
    super(`AI provider returned ${String(status)}.`);
    this.name = 'AiProviderResponseError';
  }
}

class AiRateLimitedError extends Error {
  readonly errorCode = 'AI_RATE_LIMITED';

  constructor(
    readonly stage: AiResponseStage,
    readonly retryAfterSeconds: number,
    readonly model?: string,
  ) {
    super('AI provider rate limit reached.');
    this.name = 'AiRateLimitedError';
  }
}

interface ProviderModelSelection {
  model: string;
  fallbackDecision: string;
}

const routes = new Hono<AiEnvironment>();
const stageLabels: Record<string, string> = {
  pending: 'Preparing examination pattern',
  preparing: 'Preparing examination pattern',
  generating: 'Generating questions',
  deduplicating: 'Checking duplicates',
  verifying: 'Verifying answers',
  rate_limited: 'Provider cooldown',
  retry_failed: 'Saved attempt needs a manual retry',
  retryable: 'Saved attempt is ready to resume',
  verification_pending: 'Questions saved; verification is next',
  completed: 'Test ready',
  cancelled: 'Generation cancelled',
  expired: 'Generation expired',
  invalid: 'Generation cannot continue',
  ready: 'Test ready',
  failed: 'Generation failed',
};

function signingSecret(env: Env): string | null {
  const value: unknown = Reflect.get(env, 'ATTEMPT_SIGNING_SECRET');
  return typeof value === 'string' && value.length >= 32 ? value : null;
}

async function groqContent(
  env: Env,
  attemptId: string,
  stage: AiResponseStage,
  selection: ProviderModelSelection,
  system: string,
  user: string,
  maxTokens: number,
  batchSize: number,
  temperature = 0.55,
  waitForGate = false,
): Promise<{ content: string; usage: GroqUsage }> {
  const variables = validateRuntimeEnvironment(env);
  if (variables.GROQ_ENABLED !== 'on' || !variables.GROQ_API_KEY)
    throw new Error('AI practice is temporarily unavailable.');
  let providerLock: string;
  try {
    providerLock = await acquireProviderGate(
      env.DB,
      attemptId,
      selection.model,
      stage,
      variables.AI_PROVIDER_MIN_INTERVAL_MS,
    );
  } catch (error) {
    if (!(waitForGate && error instanceof AiRateLimitedError && !error.model)) throw error;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(5_000, error.retryAfterSeconds * 1_000)),
    );
    providerLock = await acquireProviderGate(
      env.DB,
      attemptId,
      selection.model,
      stage,
      variables.AI_PROVIDER_MIN_INTERVAL_MS,
    );
  }
  const usesGptOss = selection.model.startsWith('openai/gpt-oss-');
  try {
    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${variables.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: selection.model,
        temperature,
        max_completion_tokens: maxTokens,
        response_format: { type: 'json_object' },
        ...(usesGptOss ? { reasoning_effort: 'low', include_reasoning: false } : {}),
        messages: usesGptOss
          ? [{ role: 'user', content: `${system}\n${user}` }]
          : [
              { role: 'system', content: system },
              { role: 'user', content: user },
            ],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      const retryAfterSeconds = parseRetryAfterSeconds(response.headers.get('retry-after'));
      if (response.status === 429)
        await recordProviderCooldown(env.DB, selection.model, retryAfterSeconds, response.status);
      console.log(
        JSON.stringify({
          event: 'ai_provider_request',
          attemptId,
          stage,
          model: selection.model,
          inputTokens: 0,
          outputTokens: 0,
          batchSize,
          responseStatus: response.status,
          fallbackDecision: selection.fallbackDecision,
        }),
      );
      if (response.status === 429)
        throw new AiRateLimitedError(stage, retryAfterSeconds, selection.model);
      throw new AiProviderResponseError(response.status);
    }
    const payload = groqResponseSchema.parse(await response.json());
    const content = payload.choices[0]?.message.content;
    if (content === undefined || content.trim() === '')
      throw new Error('AI response content was empty.');
    const usage = payload.usage ?? {};
    console.log(
      JSON.stringify({
        event: 'ai_provider_request',
        attemptId,
        stage,
        model: selection.model,
        inputTokens: usage.prompt_tokens ?? 0,
        outputTokens: usage.completion_tokens ?? 0,
        batchSize,
        responseStatus: response.status,
        fallbackDecision: selection.fallbackDecision,
      }),
    );
    return { content, usage };
  } finally {
    await releaseProviderGate(env.DB, providerLock, variables.AI_PROVIDER_MIN_INTERVAL_MS);
  }
}

async function selectProviderModel(
  db: D1Database,
  stage: AiResponseStage,
  generationModel: string,
  verificationModel: string,
): Promise<ProviderModelSelection> {
  const models =
    stage === 'generation' ? groqGenerationFallbackModels(generationModel) : [verificationModel];
  const now = new Date();
  const { results } = await db
    .prepare(
      `SELECT model,cooldown_until AS cooldownUntil
         FROM ai_provider_model_cooldowns WHERE cooldown_until>?`,
    )
    .bind(now.toISOString())
    .all<{ model: string; cooldownUntil: string }>();
  const cooldowns = Object.fromEntries(results.map((row) => [row.model, row.cooldownUntil]));
  const selected = selectAvailableGroqModel(models, cooldowns, now.getTime());
  if ('retryAfterSeconds' in selected)
    throw new AiRateLimitedError(stage, selected.retryAfterSeconds);
  return selected;
}

export async function acquireProviderGate(
  db: D1Database,
  attemptId: string,
  model: string,
  stage: AiResponseStage,
  minimumIntervalMs: number,
): Promise<string> {
  const token = crypto.randomUUID();
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + 35_000).toISOString();
  const result = await db
    .prepare(
      `UPDATE ai_provider_gate
          SET lock_token=?,lock_attempt_id=?,lock_model=?,lock_stage=?,lock_expires_at=?,updated_at=?
        WHERE id=1 AND next_allowed_at<=?
          AND (lock_token IS NULL OR lock_expires_at IS NULL OR lock_expires_at<=?)`,
    )
    .bind(
      token,
      attemptId,
      model,
      stage,
      leaseExpiresAt,
      now.toISOString(),
      now.toISOString(),
      now.toISOString(),
    )
    .run();
  if (result.meta.changes === 1) return token;
  const gate = await db
    .prepare(
      'SELECT lock_expires_at AS lockExpiresAt,next_allowed_at AS nextAllowedAt FROM ai_provider_gate WHERE id=1',
    )
    .first<{ lockExpiresAt: string | null; nextAllowedAt: string }>();
  const availableAt = Math.max(
    now.getTime() + minimumIntervalMs,
    ...[gate?.lockExpiresAt, gate?.nextAllowedAt]
      .map((value) => Date.parse(value ?? ''))
      .filter(Number.isFinite),
  );
  throw new AiRateLimitedError(
    stage,
    Math.max(1, Math.ceil((availableAt - now.getTime()) / 1_000)),
  );
}

export async function releaseProviderGate(
  db: D1Database,
  token: string,
  minimumIntervalMs: number,
): Promise<void> {
  const now = new Date();
  await db
    .prepare(
      `UPDATE ai_provider_gate
          SET lock_token=NULL,lock_attempt_id=NULL,lock_model=NULL,lock_stage=NULL,
              lock_expires_at=NULL,next_allowed_at=?,updated_at=?
        WHERE id=1 AND lock_token=?`,
    )
    .bind(new Date(now.getTime() + minimumIntervalMs).toISOString(), now.toISOString(), token)
    .run();
}

export async function recordProviderCooldown(
  db: D1Database,
  model: string,
  retryAfterSeconds: number,
  status: number,
): Promise<void> {
  const now = new Date();
  await db
    .prepare(
      `INSERT INTO ai_provider_model_cooldowns (model,cooldown_until,provider_status,updated_at)
       VALUES (?,?,?,?)
       ON CONFLICT(model) DO UPDATE SET cooldown_until=excluded.cooldown_until,
         provider_status=excluded.provider_status,updated_at=excluded.updated_at`,
    )
    .bind(
      model,
      new Date(now.getTime() + retryAfterSeconds * 1_000).toISOString(),
      status,
      now.toISOString(),
    )
    .run();
}

function responseShape(content: string): Record<string, unknown> {
  const withoutFence = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    const value: unknown = JSON.parse(withoutFence);
    return Array.isArray(value)
      ? { type: 'array', length: value.length }
      : typeof value === 'object' && value !== null
        ? { type: 'object', keys: Object.keys(value).sort().slice(0, 12) }
        : { type: typeof value };
  } catch {
    return { type: content.trim() === '' ? 'empty' : 'invalid_json' };
  }
}

function validationIssue(error: unknown): Record<string, unknown> {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    return {
      kind: 'schema',
      path: issue?.path.map(String).join('.') ?? '',
      message: issue?.message ?? 'Schema validation failed.',
    };
  }
  return {
    kind: 'parse',
    message: error instanceof Error ? error.message : 'Structured response parsing failed.',
  };
}

async function groqStructured<T>(
  env: Env,
  attemptId: string,
  stage: AiResponseStage,
  system: string,
  user: string,
  schema: string,
  questionCount: number,
  parse: (content: string) => T,
): Promise<{ value: T; usage: GroqUsage }> {
  const variables = validateRuntimeEnvironment(env);
  const selection = await selectProviderModel(
    env.DB,
    stage,
    variables.GROQ_MODEL,
    variables.GROQ_VERIFICATION_MODEL,
  );
  const maxTokens = groqMaxTokens(
    stage,
    questionCount,
    variables.AI_GENERATION_MAX_OUTPUT_TOKENS,
    variables.AI_VERIFICATION_MAX_OUTPUT_TOKENS,
  );
  let first: { content: string; usage: GroqUsage } | undefined;
  try {
    first = await groqContent(
      env,
      attemptId,
      stage,
      selection,
      system,
      user,
      maxTokens,
      questionCount,
    );
    const value = parse(first.content);
    console.log(
      JSON.stringify({
        event: 'ai_response_shape',
        stage,
        model: selection.model,
        responseShape: responseShape(first.content),
        validationIssue: { kind: 'none', message: 'Validated on the initial response.' },
      }),
    );
    return { value, usage: first.usage };
  } catch (error) {
    if (error instanceof AiRateLimitedError) throw error;
    if (error instanceof AiResponseInvalidError) throw error;
    const shape =
      typeof first === 'undefined' ? { type: 'provider_error' } : responseShape(first.content);
    console.error(
      JSON.stringify({
        event: 'ai_response_validation_failed',
        stage,
        model: selection.model,
        responseShape: shape,
        validationIssue: validationIssue(error),
      }),
    );
    if (typeof first === 'undefined') {
      if (!(error instanceof AiProviderResponseError) || error.status !== 400) throw error;
    }
  }

  const repair = await groqContent(
    env,
    attemptId,
    stage,
    selection,
    `You repair ${stage} JSON. Return corrected JSON only: no Markdown, commentary, or extra keys.${stage === 'verification' ? ' Return exactly one result for every questionId in ORIGINAL_REQUEST; preserve each ID exactly, omit none, and keep rejectionReason null or at most 180 characters.' : ''}`,
    first
      ? `Correct the response to satisfy the original request and this exact schema: ${schema}\nORIGINAL_REQUEST:\n${user}\nRESPONSE_TO_REPAIR:\n${first.content}`
      : `The previous response was rejected as invalid JSON. Complete the original request below and return only a JSON object matching this exact schema: ${schema}\nORIGINAL_REQUEST:\n${user}`,
    maxTokens,
    questionCount,
    0,
    true,
  );
  const usage = {
    prompt_tokens: (first?.usage.prompt_tokens ?? 0) + (repair.usage.prompt_tokens ?? 0),
    completion_tokens:
      (first?.usage.completion_tokens ?? 0) + (repair.usage.completion_tokens ?? 0),
  };
  try {
    const value = parse(repair.content);
    console.log(
      JSON.stringify({
        event: 'ai_response_shape',
        stage,
        model: selection.model,
        responseShape: responseShape(repair.content),
        validationIssue: { kind: 'none', message: 'Validated after one repair.' },
      }),
    );
    return { value, usage };
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'ai_response_validation_failed',
        stage,
        model: selection.model,
        responseShape: responseShape(repair.content),
        validationIssue: validationIssue(error),
      }),
    );
    throw new AiResponseInvalidError(stage);
  }
}

async function updateStage(db: D1Database, attemptId: string, stage: string): Promise<void> {
  const at = new Date().toISOString();
  await db.batch([
    db.prepare('UPDATE attempts SET generation_status = ? WHERE id = ?').bind(stage, attemptId),
    db
      .prepare(
        'UPDATE generation_runs SET stage = ?, status = ?, started_at = COALESCE(started_at, ?) WHERE attempt_id = ?',
      )
      .bind(stage, stage === 'ready' ? 'completed' : 'running', at, attemptId),
  ]);
}

const stagedCandidateSchema = z.object({
  questionId: z.string().min(1),
  question: generatedQuestionSchema,
  verificationConfidence: z.number().min(0).max(1).optional(),
  verificationReason: z.string().max(180).optional(),
  verificationMethod: z.enum(['model', 'deterministic']).optional(),
});
const candidateSnapshotSchema = z.object({
  accepted: z.array(stagedCandidateSchema),
  pending: z.array(stagedCandidateSchema),
  excluded: z.array(z.string()),
  round: z.number().int().min(0).max(120),
  rejectedCount: z.number().int().min(0),
  generationInputTokens: z.number().int().min(0).default(0),
  generationOutputTokens: z.number().int().min(0).default(0),
  verificationInputTokens: z.number().int().min(0).default(0),
  verificationOutputTokens: z.number().int().min(0).default(0),
});
type StagedCandidate = z.infer<typeof stagedCandidateSchema>;
type CandidateSnapshot = z.infer<typeof candidateSnapshotSchema>;

interface GenerationRunRecord {
  id: string;
  stage: string;
  status: string;
  candidate_json: string | null;
  cooldown_until: string | null;
  retry_stage: AiResponseStage | null;
  auto_retry_used: number;
  lock_token: string | null;
  lock_expires_at: string | null;
  input_tokens: number;
  output_tokens: number;
  state: GenerationRunStateName;
  failed_stage: GenerationWorkStage | null;
  failure_recoverable: number;
  state_updated_at: string | null;
  resume_count: number;
}

function attemptGenerationStatus(state: GenerationRunStateName): string {
  if (state === 'pending') return 'pending';
  if (state === 'ready' || state === 'completed') return 'ready';
  if (state === 'verification_pending' || state === 'verifying') return 'verifying';
  if (state === 'cancelled' || state === 'expired' || state === 'invalid') return 'failed';
  return 'generating';
}

async function transitionGenerationState(
  db: D1Database,
  attemptId: string,
  previousState: GenerationRunStateName,
  nextState: GenerationRunStateName,
  stage: GenerationWorkStage,
  options: {
    clearLock?: boolean;
    error?: string | null;
    lockToken?: string;
    status?: 'pending' | 'running' | 'completed' | 'failed' | 'exhausted';
  } = {},
): Promise<boolean> {
  const now = new Date().toISOString();
  const lockClause = options.lockToken ? ' AND lock_token=?' : '';
  const bindings: unknown[] = [
    nextState,
    nextState,
    options.status ??
      (nextState === 'ready' || nextState === 'completed' ? 'completed' : 'running'),
    nextState === 'retryable' || nextState === 'rate_limited' ? stage : null,
    nextState === 'retryable' ? 1 : 0,
    options.error ?? null,
    now,
    options.clearLock ? 1 : 0,
    options.clearLock ? 1 : 0,
    options.clearLock ? 1 : 0,
    attemptId,
    previousState,
  ];
  if (options.lockToken) bindings.push(options.lockToken);
  const result = await db
    .prepare(
      `UPDATE generation_runs
          SET state=?,stage=?,status=?,failed_stage=?,failure_recoverable=?,error_summary=?,
              state_updated_at=?,
              lock_stage=CASE WHEN ?=1 THEN NULL ELSE lock_stage END,
              lock_token=CASE WHEN ?=1 THEN NULL ELSE lock_token END,
              lock_expires_at=CASE WHEN ?=1 THEN NULL ELSE lock_expires_at END
        WHERE attempt_id=? AND state=?${lockClause}`,
    )
    .bind(...bindings)
    .run();
  if (result.meta.changes !== 1) return false;
  await db
    .prepare('UPDATE attempts SET generation_status=?,generation_error=? WHERE id=?')
    .bind(attemptGenerationStatus(nextState), options.error ?? null, attemptId)
    .run();
  console.log(
    JSON.stringify({
      event: 'ai_generation_transition',
      attemptId,
      previousState,
      nextState,
      stage,
    }),
  );
  return true;
}

function acceptedGenerationPayload(
  attemptId: string,
  status: GenerationRunStateName,
  stage: GenerationWorkStage,
  retryAfterSeconds = 20,
) {
  return {
    attemptId,
    errorCode: 'GENERATION_ACCEPTED' as const,
    status,
    stage,
    retryAfterSeconds,
    recoverable: true,
  };
}

function emptySnapshot(): CandidateSnapshot {
  return {
    accepted: [],
    pending: [],
    excluded: [],
    round: 0,
    rejectedCount: 0,
    generationInputTokens: 0,
    generationOutputTokens: 0,
    verificationInputTokens: 0,
    verificationOutputTokens: 0,
  };
}

function readSnapshot(value: string | null): CandidateSnapshot {
  return value ? candidateSnapshotSchema.parse(JSON.parse(value)) : emptySnapshot();
}

async function saveSnapshot(
  db: D1Database,
  attemptId: string,
  snapshot: CandidateSnapshot,
): Promise<void> {
  await db
    .prepare(
      `UPDATE generation_runs
          SET candidate_json=?, accepted_count=?, rejected_count=?
        WHERE attempt_id=?`,
    )
    .bind(JSON.stringify(snapshot), snapshot.accepted.length, snapshot.rejectedCount, attemptId)
    .run();
}

async function acquireGenerationLock(
  db: D1Database,
  attemptId: string,
  stage: AiResponseStage,
  automaticRetry: boolean,
): Promise<string | null> {
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 120_000).toISOString();
  const result = await db
    .prepare(
      `UPDATE generation_runs
          SET lock_stage=?, lock_token=?, lock_expires_at=?,
              auto_retry_used=CASE WHEN ?=1 THEN 1 ELSE auto_retry_used END,
              resume_count=resume_count+CASE WHEN state IN ('retryable','rate_limited') THEN 1 ELSE 0 END
        WHERE attempt_id=?
          AND (lock_token IS NULL OR lock_expires_at IS NULL OR lock_expires_at<=?)
          AND (?=0 OR auto_retry_used=0)`,
    )
    .bind(
      stage,
      token,
      expiresAt,
      automaticRetry ? 1 : 0,
      attemptId,
      now.toISOString(),
      automaticRetry ? 1 : 0,
    )
    .run();
  return result.meta.changes === 1 ? token : null;
}

async function releaseGenerationLock(
  db: D1Database,
  attemptId: string,
  token: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE generation_runs
          SET lock_stage=NULL,lock_token=NULL,lock_expires_at=NULL
        WHERE attempt_id=? AND lock_token=?`,
    )
    .bind(attemptId, token)
    .run();
}

async function refreshGenerationLock(
  db: D1Database,
  attemptId: string,
  token: string,
  stage: AiResponseStage,
): Promise<void> {
  const expiresAt = new Date(Date.now() + 120_000).toISOString();
  const result = await db
    .prepare(
      `UPDATE generation_runs SET lock_stage=?,lock_expires_at=?
        WHERE attempt_id=? AND lock_token=?`,
    )
    .bind(stage, expiresAt, attemptId, token)
    .run();
  if (result.meta.changes !== 1) throw new Error('Generation lock was lost.');
}

async function addSuccessfulUsage(env: Env, attemptId: string, usage: GroqUsage): Promise<void> {
  const input = usage.prompt_tokens ?? 0;
  const output = usage.completion_tokens ?? 0;
  await env.DB.prepare(
    `UPDATE generation_runs
          SET input_tokens=input_tokens+?,output_tokens=output_tokens+?
        WHERE attempt_id=?`,
  )
    .bind(input, output, attemptId)
    .run();
  const tokenKey = `ai:tokens:${new Date().toISOString().slice(0, 10)}`;
  try {
    const used = Number((await env.PUBLIC_CACHE.get(tokenKey)) ?? 0);
    await env.PUBLIC_CACHE.put(tokenKey, String(used + input + output), {
      expirationTtl: 172800,
    });
  } catch {
    console.error(
      JSON.stringify({
        event: 'ai_token_counter_failed',
        stage: 'usage',
        model: 'not_applicable',
        responseShape: { type: 'none' },
        validationIssue: { kind: 'storage', message: 'Token counter update failed.' },
      }),
    );
  }
}

function rateLimitPayload(stage: AiResponseStage, retryAfterSeconds: number) {
  return {
    error: 'AI provider is cooling down. Your generated questions are safely preserved.',
    errorCode: 'AI_RATE_LIMITED' as const,
    status: 'rate_limited' as const,
    stage,
    retryAfterSeconds,
    recoverable: true,
  };
}

async function requestFingerprint(request: AiTestRequest): Promise<string> {
  return sha256(
    JSON.stringify({
      ...request,
      visitorUuid: undefined,
      nickname: undefined,
      turnstileToken: undefined,
    }),
  );
}

routes.get('/api/ai/config', (context) => {
  const variables = validateRuntimeEnvironment(context.env);
  return context.json({
    examinations: aiExamConfigurations,
    questionCounts: [5, 10, 15, 20, 25, 50],
    stages: Object.values(stageLabels).slice(0, 5),
    similarityThreshold: 0.78,
    clientRetrySeconds: variables.AI_CLIENT_RETRY_SECONDS,
  });
});

routes.post('/api/ai/attempts', zValidator('json', aiTestRequestSchema), async (context) => {
  const variables = validateRuntimeEnvironment(context.env);
  const secret = signingSecret(context.env);
  if (!secret || variables.GROQ_ENABLED !== 'on' || variables.AI_GENERATION_ENABLED !== 'on')
    return context.json(
      {
        error:
          'AI practice is temporarily unavailable. Existing results and study tools remain available.',
      },
      503,
    );
  const input = context.req.valid('json');
  if (!(await verifyTurnstile(input.turnstileToken, variables)))
    return context.json({ error: 'Human verification was not completed.' }, 403);
  const config = examConfiguration(input.examinationSlug);
  if (!config?.tiers.includes(input.tierStage))
    return context.json({ error: 'Unsupported examination configuration.' }, 400);
  if (input.subject !== 'All subjects' && !Object.hasOwn(config.subjects, input.subject))
    return context.json({ error: 'Subject is outside this examination syllabus.' }, 400);
  const visitor = await context.env.DB.prepare(
    'SELECT visitor_number FROM anonymous_visitors WHERE visitor_uuid = ?',
  )
    .bind(input.visitorUuid)
    .first<{ visitor_number: number }>();
  if (!visitor) return context.json({ error: 'Anonymous visitor not found.' }, 404);
  const day = new Date().toISOString().slice(0, 10);
  const visitorKey = `ai:visitor:${String(visitor.visitor_number)}:${day}`;
  const globalKey = `ai:global:${day}`;
  const tokenKey = `ai:tokens:${day}`;
  const [visitorCount, globalCount, globalTokens] = await Promise.all([
    context.env.PUBLIC_CACHE.get(visitorKey),
    context.env.PUBLIC_CACHE.get(globalKey),
    context.env.PUBLIC_CACHE.get(tokenKey),
  ]);
  const perVisitorLimit = variables.AI_VISITOR_DAILY_LIMIT;
  const globalLimit = variables.AI_GLOBAL_DAILY_REQUEST_LIMIT;
  if (Number(visitorCount ?? 0) >= perVisitorLimit || Number(globalCount ?? 0) >= globalLimit)
    return context.json(
      {
        error:
          'AI practice is temporarily unavailable because today’s generation limit was reached.',
      },
      429,
    );
  if (Number(globalTokens ?? 0) >= variables.AI_GLOBAL_DAILY_TOKEN_LIMIT)
    return context.json(
      { error: 'AI practice is temporarily unavailable because today’s token limit was reached.' },
      429,
    );
  const examination = await context.env.DB.prepare(
    'SELECT id FROM examinations WHERE slug = ? AND enabled = 1',
  )
    .bind(config.slug)
    .first<{ id: string }>();
  if (!examination) return context.json({ error: 'Examination not found.' }, 404);
  const requestedCount = input.fullMock ? config.standardQuestions : (input.questionCount ?? 10);
  const durationSeconds =
    input.timerMode === 'untimed'
      ? 24 * 60 * 60
      : (input.fullMock || input.timerMode === 'standard'
          ? config.standardDurationMinutes
          : (input.customDurationMinutes ?? 10)) * 60;
  const id = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const placeholderExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const fingerprint = await requestFingerprint(input);
  const activeKey = `${String(visitor.visitor_number)}:${fingerprint}`;
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO attempts
        (id,visitor_number,examination_id,pattern_id,mode,tier_stage,nickname,category,region,post_name,stage_name,selection_json,comparison_key,status,question_count,duration_seconds,started_at,expires_at,created_at,generation_status)
        VALUES (?,?,?,NULL,'custom',?,?,?,?,?,?,?,NULL,'active',?,?,?, ?,?,'pending')`,
      ).bind(
        id,
        visitor.visitor_number,
        examination.id,
        input.tierStage,
        input.nickname ?? null,
        input.category ?? null,
        input.region ?? null,
        input.post ?? null,
        input.tierStage,
        JSON.stringify(input),
        requestedCount,
        durationSeconds,
        createdAt,
        placeholderExpiry,
        createdAt,
      ),
      context.env.DB.prepare(
        `INSERT INTO generation_runs
        (id,attempt_id,visitor_number,request_fingerprint,active_key,stage,status,requested_count,created_at)
        VALUES (?,?,?,?,?,'pending','pending',?,?)`,
      ).bind(runId, id, visitor.visitor_number, fingerprint, activeKey, requestedCount, createdAt),
    ]);
  } catch {
    const existing = await context.env.DB.prepare(
      `SELECT r.attempt_id AS attemptId,r.state,a.question_count AS questionCount
         FROM generation_runs r JOIN attempts a ON a.id=r.attempt_id
        WHERE r.active_key=? AND r.state NOT IN ('ready','completed','cancelled','expired','invalid')`,
    )
      .bind(activeKey)
      .first<{ attemptId: string; state: GenerationRunStateName; questionCount: number }>();
    if (!existing)
      return context.json(
        {
          error: 'The attempt could not be created.',
          errorCode: 'ATTEMPT_CREATE_CONFLICT',
          recoverable: false,
        },
        409,
      );
    const existingToken = await signAttemptToken(
      {
        attemptId: existing.attemptId,
        visitorNumber: visitor.visitor_number,
        issuedAt: Math.floor(Date.now() / 1000),
        nonce: crypto.randomUUID(),
      },
      secret,
    );
    return context.json(
      {
        attemptId: existing.attemptId,
        attemptToken: existingToken,
        generationStatus: existing.state,
        status: existing.state,
        errorCode: 'ATTEMPT_REUSED',
        recoverable: true,
      },
      202,
    );
  }
  await Promise.all([
    context.env.PUBLIC_CACHE.put(visitorKey, String(Number(visitorCount ?? 0) + 1), {
      expirationTtl: 172800,
    }),
    context.env.PUBLIC_CACHE.put(globalKey, String(Number(globalCount ?? 0) + 1), {
      expirationTtl: 172800,
    }),
  ]);
  const token = await signAttemptToken(
    {
      attemptId: id,
      visitorNumber: visitor.visitor_number,
      issuedAt: Math.floor(Date.now() / 1000),
      nonce: crypto.randomUUID(),
    },
    secret,
  );
  return context.json(
    { attemptId: id, attemptToken: token, generationStatus: 'pending', stage: stageLabels.pending },
    202,
  );
});

routes.get('/api/ai/attempts/:id/generation', async (context) => {
  const attempt = await authorizedAttempt(context.req.raw, context.env, context.req.param('id'));
  if (!attempt) return context.json({ error: 'Attempt not found.' }, 404);
  const run = await context.env.DB.prepare(
    `SELECT state,stage,status,requested_count AS requestedCount,accepted_count AS acceptedCount,
            rejected_count AS rejectedCount,error_summary AS error,cooldown_until AS cooldownUntil,
            COALESCE(failed_stage,retry_stage) AS retryStage,auto_retry_used AS autoRetryUsed,
            CASE WHEN lock_token IS NOT NULL
              AND lock_expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE 0 END AS locked,
            lock_expires_at AS lockExpiresAt
       FROM generation_runs WHERE attempt_id = ?`,
  )
    .bind(attempt.id)
    .first<Record<string, unknown> & { stage: string; state: GenerationRunStateName }>();
  return context.json({
    ...run,
    stageLabel: stageLabels[run?.state ?? run?.stage ?? 'pending'],
    status: run?.state ?? run?.status,
  });
});

routes.post('/api/ai/attempts/:id/generate', async (context) => {
  const attempt = await authorizedAttempt(context.req.raw, context.env, context.req.param('id'));
  if (!attempt) return context.json({ error: 'Attempt not found.' }, 404);
  const row = await context.env.DB.prepare(
    `SELECT selection_json,generation_status,question_count,duration_seconds,examination_id,
            started_at,expires_at,status,submitted_at,score_json FROM attempts WHERE id = ?`,
  )
    .bind(attempt.id)
    .first<{
      selection_json: string;
      generation_status: string;
      question_count: number;
      duration_seconds: number;
      examination_id: string;
      started_at: string;
      expires_at: string;
      status: 'active' | 'submitted' | 'timed_out' | 'abandoned';
      submitted_at: string | null;
      score_json: string | null;
    }>();
  if (!row) return context.json({ error: 'Attempt not found.' }, 404);
  if (row.generation_status === 'ready')
    return context.json(
      {
        attemptId: attempt.id,
        questionCount: row.question_count,
        durationSeconds: row.duration_seconds,
        startedAt: row.started_at,
        expiresAt: row.expires_at,
        generationStatus: 'ready',
        stage: stageLabels.ready,
      },
      200,
    );
  let runState = await context.env.DB.prepare(
    `SELECT id,stage,status,candidate_json,cooldown_until,retry_stage,auto_retry_used,
            lock_token,lock_expires_at,input_tokens,output_tokens,state,failed_stage,
            failure_recoverable,state_updated_at,resume_count
       FROM generation_runs WHERE attempt_id=?`,
  )
    .bind(attempt.id)
    .first<GenerationRunRecord>();
  if (!runState) return context.json({ error: 'Generation run not found.' }, 404);
  if (row.score_json !== null || row.submitted_at !== null || row.status === 'submitted')
    return context.json(
      {
        error: 'A scored attempt cannot be generated again.',
        errorCode: 'ATTEMPT_INVALID',
        status: 'invalid',
        recoverable: false,
      },
      409,
    );
  if (
    row.status === 'timed_out' ||
    (row.status === 'active' && Date.now() >= Date.parse(row.expires_at))
  ) {
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE generation_runs SET state='expired',stage='expired',status='failed',
            failure_recoverable=0,active_key=NULL,state_updated_at=?,lock_stage=NULL,
            lock_token=NULL,lock_expires_at=NULL WHERE attempt_id=?`,
      ).bind(new Date().toISOString(), attempt.id),
      context.env.DB.prepare(
        `UPDATE attempts SET generation_status='failed',generation_error='Generation lease expired.',
            status='abandoned' WHERE id=? AND status='active'`,
      ).bind(attempt.id),
    ]);
    console.log(
      JSON.stringify({
        event: 'ai_generation_transition',
        attemptId: attempt.id,
        previousState: runState.state,
        nextState: 'expired',
        stage: runState.failed_stage ?? 'generation',
      }),
    );
    return context.json(
      {
        error: 'This attempt expired before generation completed.',
        errorCode: 'ATTEMPT_EXPIRED',
        status: 'expired',
        recoverable: false,
      },
      409,
    );
  }
  const automaticRetry = context.req.query('retry') === 'automatic';
  const decision = decideGenerationAction({
    state: runState.state,
    failedStage: runState.failed_stage ?? runState.retry_stage,
    cooldownUntil: runState.cooldown_until,
    lockExpiresAt: runState.lock_expires_at,
  });
  if (decision.action === 'ready')
    return context.json(
      {
        attemptId: attempt.id,
        questionCount: row.question_count,
        durationSeconds: row.duration_seconds,
        startedAt: row.started_at,
        expiresAt: row.expires_at,
        generationStatus: 'ready',
        status: 'ready',
        stage: stageLabels.ready,
      },
      200,
    );
  if (decision.action === 'terminal')
    return context.json(
      {
        error: 'This attempt cannot be resumed.',
        errorCode: decision.errorCode,
        status: runState.state,
        recoverable: false,
      },
      409,
    );
  if (decision.action === 'already_running')
    return context.json(
      {
        errorCode: 'GENERATION_ALREADY_RUNNING',
        status: runState.state,
        stage: runState.failed_stage ?? runState.retry_stage ?? 'generation',
        retryAfterSeconds: Math.min(5, decision.retryAfterSeconds),
        recoverable: true,
      },
      202,
    );
  if (decision.action === 'rate_limited')
    return context.json(rateLimitPayload(decision.stage, decision.retryAfterSeconds), 429);
  let workStage: AiResponseStage = decision.stage;
  if (automaticRetry && runState.auto_retry_used === 1)
    return context.json(
      {
        error: 'Automatic retry was already used. Retry manually when cooldown ends.',
        errorCode: 'AI_AUTO_RETRY_USED',
        status: runState.state,
        stage: workStage,
        recoverable: true,
      },
      409,
    );
  const lockToken = await acquireGenerationLock(
    context.env.DB,
    attempt.id,
    workStage,
    automaticRetry,
  );
  if (!lockToken)
    return context.json(
      {
        error: 'Generation is already running for this attempt.',
        errorCode: 'GENERATION_ALREADY_RUNNING',
        status: runState.state,
        stage: workStage,
        retryAfterSeconds: 2,
        recoverable: true,
      },
      202,
    );
  const activeState: GenerationRunStateName =
    workStage === 'verification' ? 'verifying' : 'generating';
  const transitioned = await transitionGenerationState(
    context.env.DB,
    attempt.id,
    runState.state,
    activeState,
    workStage,
    { lockToken },
  );
  if (!transitioned) {
    await releaseGenerationLock(context.env.DB, attempt.id, lockToken);
    return context.json(
      {
        errorCode: 'GENERATION_ALREADY_RUNNING',
        status: runState.state,
        stage: workStage,
        retryAfterSeconds: 2,
        recoverable: true,
      },
      202,
    );
  }
  runState = { ...runState, state: activeState };
  const request = aiTestRequestSchema.parse(JSON.parse(row.selection_json));
  const config = examConfiguration(request.examinationSlug);
  if (!config) {
    await transitionGenerationState(
      context.env.DB,
      attempt.id,
      runState.state,
      'invalid',
      workStage,
      { clearLock: true, error: 'Unsupported examination.', lockToken, status: 'failed' },
    );
    return context.json(
      {
        error: 'Unsupported examination.',
        errorCode: 'ATTEMPT_INVALID',
        status: 'invalid',
        recoverable: false,
      },
      409,
    );
  }
  const variables = validateRuntimeEnvironment(context.env);
  const maxGenerationRounds = Math.min(
    120,
    Math.ceil(row.question_count / variables.AI_GENERATION_BATCH_SIZE) * 2 + 4,
  );
  const snapshot = readSnapshot(runState.candidate_json);
  let totalInputTokens = runState.input_tokens;
  let totalOutputTokens = runState.output_tokens;
  const accepted: GeneratedQuestion[] = snapshot.accepted.map((item) => item.question);
  const acceptedExact = new Set<string>();
  let rejectedCount = snapshot.rejectedCount;
  try {
    await context.env.DB.prepare(
      `UPDATE generation_runs
          SET cooldown_until=NULL,retry_stage=NULL,error_summary=NULL
        WHERE attempt_id=? AND lock_token=?`,
    )
      .bind(attempt.id, lockToken)
      .run();
    await updateStage(context.env.DB, attempt.id, 'preparing');
    const { results: historyRows } = await context.env.DB.prepare(
      `
      SELECT f.exact_sha256 AS exact, q.question_text AS text, f.created_at AS seenAt
        FROM question_fingerprints f JOIN questions q ON q.id=f.question_id
        LEFT JOIN visitor_question_history h ON h.question_id=q.id
       WHERE h.visitor_number=? OR f.created_at >= datetime('now','-30 days')
      UNION
      SELECT '' AS exact, q.question_text AS text, a.created_at AS seenAt
        FROM attempt_questions aq JOIN attempts a ON a.id=aq.attempt_id
        JOIN questions q ON q.id=aq.question_id WHERE a.visitor_number=?
      UNION
      SELECT '' AS exact, q.question_text AS text, q.created_at AS seenAt
        FROM questions q WHERE q.verification_status='published'
      UNION
      SELECT normalized_sha256 AS exact, '' AS text, created_at AS seenAt
        FROM attempt_generation_hashes WHERE attempt_id=?
      ORDER BY seenAt DESC LIMIT 900`,
    )
      .bind(attempt.visitor_number, attempt.visitor_number, attempt.id)
      .all<{ exact: string; text: string; seenAt: string }>();
    const history = await Promise.all(
      historyRows.map(async (item) => ({
        exact: item.exact || (await sha256(normaliseQuestion(item.text))),
        text: item.text,
      })),
    );
    for (const question of accepted)
      acceptedExact.add(await sha256(normaliseQuestion(question.question)));
    const excluded = [...history.map((item) => item.exact), ...snapshot.excluded];

    const verifyPending = async (): Promise<void> => {
      if (snapshot.pending.length === 0) return;
      workStage = 'verification';
      await updateStage(context.env.DB, attempt.id, 'verifying');
      const modelCandidates: StagedCandidate[] = [];
      for (const candidate of snapshot.pending) {
        const deterministic = deterministicArithmeticAnswer(candidate.question);
        if (deterministic === true) {
          candidate.verificationConfidence = 1;
          candidate.verificationReason = 'Verified by deterministic arithmetic.';
          candidate.verificationMethod = 'deterministic';
          snapshot.accepted.push(candidate);
          accepted.push(candidate.question);
          acceptedExact.add(await sha256(normaliseQuestion(candidate.question.question)));
        } else if (deterministic === false) {
          rejectedCount += 1;
          snapshot.rejectedCount = rejectedCount;
          const exact = await sha256(normaliseQuestion(candidate.question.question));
          snapshot.excluded.push(exact);
          excluded.push(exact);
        } else {
          modelCandidates.push(candidate);
        }
      }
      snapshot.pending = modelCandidates;
      await saveSnapshot(context.env.DB, attempt.id, snapshot);
      if (modelCandidates.length === 0) return;

      await refreshGenerationLock(context.env.DB, attempt.id, lockToken, 'verification');
      const verification = await groqStructured(
        context.env,
        attempt.id,
        'verification',
        `Verify every supplied MCQ independently. Return exactly one result per questionId and preserve each ID. Keep rejectionReason null or at most 180 characters. Reject ambiguity, wrong answers, weak support, unstable facts, missing context, unsafe content or syllabus drift. Do not repeat questions or options. Return only JSON matching: ${verificationResponseJsonSchema}`,
        JSON.stringify(compactVerificationPayload(modelCandidates)),
        verificationResponseJsonSchema,
        modelCandidates.length,
        (content) =>
          requireVerificationCoverage(
            parseVerificationContent(content),
            modelCandidates.map((candidate) => candidate.questionId),
          ),
      );
      await addSuccessfulUsage(context.env, attempt.id, verification.usage);
      totalInputTokens += verification.usage.prompt_tokens ?? 0;
      totalOutputTokens += verification.usage.completion_tokens ?? 0;
      snapshot.verificationInputTokens += verification.usage.prompt_tokens ?? 0;
      snapshot.verificationOutputTokens += verification.usage.completion_tokens ?? 0;
      const reviews: VerificationBatch = verification.value;
      const reviewById = new Map(reviews.results.map((review) => [review.questionId, review]));
      for (const candidate of modelCandidates) {
        const review = reviewById.get(candidate.questionId);
        const proposed = candidate.question.correctOptionIndex;
        const acceptedReview =
          review?.status === 'verified' &&
          review.confidence >= 0.8 &&
          (review.correctedOptionIndex === null || review.correctedOptionIndex === proposed);
        if (!acceptedReview) {
          rejectedCount += 1;
          snapshot.rejectedCount = rejectedCount;
          const exact = await sha256(normaliseQuestion(candidate.question.question));
          snapshot.excluded.push(exact);
          excluded.push(exact);
        } else {
          candidate.verificationConfidence = review.confidence;
          candidate.verificationReason =
            review.rejectionReason ?? 'Independent model verification passed.';
          candidate.verificationMethod = 'model';
          snapshot.accepted.push(candidate);
          accepted.push(candidate.question);
          acceptedExact.add(await sha256(normaliseQuestion(candidate.question.question)));
        }
      }
      snapshot.pending = [];
      await saveSnapshot(context.env.DB, attempt.id, snapshot);
    };

    const hadPendingCandidates = snapshot.pending.length > 0;
    await verifyPending();
    if (
      hadPendingCandidates &&
      snapshot.round < maxGenerationRounds &&
      accepted.length < row.question_count
    ) {
      await transitionGenerationState(
        context.env.DB,
        attempt.id,
        runState.state,
        'generating',
        'generation',
        { clearLock: true, lockToken },
      );
      return context.json(
        acceptedGenerationPayload(
          attempt.id,
          'generating',
          'generation',
          variables.AI_CLIENT_RETRY_SECONDS,
        ),
        202,
      );
    }
    if (snapshot.round < maxGenerationRounds && accepted.length < row.question_count) {
      const round = snapshot.round;
      workStage = 'generation';
      await updateStage(context.env.DB, attempt.id, 'generating');
      await refreshGenerationLock(context.env.DB, attempt.id, lockToken, 'generation');
      const needed = generationBatchSize(
        row.question_count - accepted.length,
        variables.AI_GENERATION_BATCH_SIZE,
      );
      const generated = await groqStructured(
        context.env,
        attempt.id,
        'generation',
        'Write syllabus-bound examination MCQs. Return JSON only.',
        buildGenerationPrompt(config, request, needed, crypto.randomUUID()),
        generationResponseJsonSchema,
        needed,
        (content) =>
          parseGenerationContent(content, {
            difficulty: request.difficulty === 'mixed' ? 'medium' : request.difficulty,
            language: request.language,
          }),
      );
      await addSuccessfulUsage(context.env, attempt.id, generated.usage);
      totalInputTokens += generated.usage.prompt_tokens ?? 0;
      totalOutputTokens += generated.usage.completion_tokens ?? 0;
      snapshot.generationInputTokens += generated.usage.prompt_tokens ?? 0;
      snapshot.generationOutputTokens += generated.usage.completion_tokens ?? 0;
      const batch = generatedBatchSchema.parse(generated.value);
      await updateStage(context.env.DB, attempt.id, 'deduplicating');
      const candidates: GeneratedQuestion[] = [];
      const candidateHashes: string[] = [];
      for (const question of batch.questions) {
        if (accepted.length + candidates.length >= row.question_count) break;
        const exact = await sha256(normaliseQuestion(question.question));
        const optionHash = await sha256(optionIndependentText(question));
        const duplicate =
          acceptedExact.has(exact) ||
          history.some(
            (item) => item.exact === exact || tokenSimilarity(item.text, question.question) >= 0.78,
          ) ||
          [...accepted, ...candidates].some(
            (item) =>
              optionIndependentText(item) === optionIndependentText(question) ||
              tokenSimilarity(item.question, question.question) >= 0.78,
          );
        if (duplicate || deterministicQuestionIssues(question).length > 0) {
          rejectedCount += 1;
          excluded.push(exact, optionHash);
          continue;
        }
        candidates.push(question);
        candidateHashes.push(exact);
      }
      snapshot.round = round + 1;
      snapshot.rejectedCount = rejectedCount;
      snapshot.excluded = excluded.slice(-120);
      snapshot.pending = candidates.map((question) => ({
        questionId: crypto.randomUUID(),
        question,
      }));
      const snapshotSavedAt = new Date().toISOString();
      await context.env.DB.batch([
        context.env.DB.prepare(
          `UPDATE generation_runs
                SET candidate_json=?,accepted_count=?,rejected_count=? WHERE attempt_id=?`,
        ).bind(
          JSON.stringify(snapshot),
          snapshot.accepted.length,
          snapshot.rejectedCount,
          attempt.id,
        ),
        ...snapshot.pending.map((_, index) =>
          context.env.DB.prepare(
            `INSERT OR IGNORE INTO attempt_generation_hashes
                (id,attempt_id,normalized_sha256,created_at) VALUES (?,?,?,?)`,
          ).bind(crypto.randomUUID(), attempt.id, candidateHashes[index] ?? '', snapshotSavedAt),
        ),
      ]);
      const nextState: GenerationRunStateName =
        candidates.length === 0 ? 'generating' : 'verification_pending';
      await transitionGenerationState(
        context.env.DB,
        attempt.id,
        runState.state,
        nextState,
        candidates.length === 0 ? 'generation' : 'verification',
        { clearLock: true, lockToken },
      );
      return context.json(
        acceptedGenerationPayload(
          attempt.id,
          nextState,
          candidates.length === 0 ? 'generation' : 'verification',
          variables.AI_CLIENT_RETRY_SECONDS,
        ),
        202,
      );
    }
    if (accepted.length !== row.question_count)
      throw new Error(
        'The unique-question pool for this selection is exhausted. Try another topic, difficulty, or examination.',
      );
    const createdAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < snapshot.accepted.length; index += 1) {
      const candidate = snapshot.accepted[index];
      if (!candidate) continue;
      const { question, questionId } = candidate;
      const exact = await sha256(normaliseQuestion(question.question));
      const stem = await sha256(
        normaliseQuestion(question.question).replace(/\b\d+(?:\.\d+)?\b/g, '#'),
      );
      const optionHash = await sha256(optionIndependentText(question));
      const difficulty = question.difficulty === 'medium' ? 'moderate' : question.difficulty;
      const reviewer =
        candidate.verificationMethod === 'deterministic'
          ? 'deterministic-arithmetic'
          : 'ai-independent-verifier';
      statements.push(
        context.env.DB.prepare(
          `INSERT INTO questions (id,document_id,examination_id,qualification_level,tier_stage,year,section,subject,topic,difficulty,question_type,question_text,explanation_markdown,positive_marks,negative_marks,source_page,language,content_origin,verification_status,content_hash,reviewer_ref,last_verified_at,published_at,created_at) VALUES (?,'document-examforge-ai',?,?,?,2026,?,?,?,?, 'single_choice_mcq',?,?,?,?,?,?,'ai_generated_practice','published',?,?,?,?,?)`,
        ).bind(
          questionId,
          row.examination_id,
          config.level,
          request.tierStage,
          question.subject,
          question.subject,
          question.topic,
          difficulty,
          question.question,
          question.explanation,
          config.positiveMarks,
          config.negativeMarks,
          1,
          question.language,
          exact,
          reviewer,
          createdAt,
          createdAt,
          createdAt,
        ),
        ...question.options.map((option, optionIndex) =>
          context.env.DB.prepare(
            'INSERT INTO question_options (id,question_id,option_index,option_text) VALUES (?,?,?,?)',
          ).bind(crypto.randomUUID(), questionId, optionIndex, option),
        ),
        context.env.DB.prepare(
          `INSERT INTO answer_key_versions (id,question_id,source_id,key_type,version_label,correct_option_index,is_current,reviewer_ref,effective_at,created_at) VALUES (?,?,'source-examforge-ai','editorial',?,?,1,?,?,?)`,
        ).bind(
          crypto.randomUUID(),
          questionId,
          config.promptVersion,
          question.correctOptionIndex,
          reviewer,
          createdAt,
          createdAt,
        ),
        context.env.DB.prepare(
          `INSERT INTO generated_questions (question_id,generation_run_id,prompt_version,explanation,verification_status,verification_confidence,verification_reason,created_at) VALUES (?,?,?,?,'verified',?,?,?)`,
        ).bind(
          questionId,
          runState.id,
          config.promptVersion,
          question.explanation,
          candidate.verificationConfidence ?? 0.8,
          candidate.verificationReason ?? 'Verification passed.',
          createdAt,
        ),
        context.env.DB.prepare(
          'INSERT INTO question_fingerprints (question_id,exact_sha256,stem_sha256,option_order_independent_sha256,normalised_tokens,concept_key,created_at) VALUES (?,?,?,?,?,?,?)',
        ).bind(
          questionId,
          exact,
          stem,
          optionHash,
          normaliseQuestion(question.question),
          `${config.slug}:${question.subject}:${question.topic}`,
          createdAt,
        ),
        context.env.DB.prepare(
          `INSERT INTO visitor_question_history (visitor_number,question_id,exact_sha256,shown_at,mode) VALUES (?,?,?,?,'ai_test')`,
        ).bind(attempt.visitor_number, questionId, exact, createdAt),
        context.env.DB.prepare(
          'INSERT INTO attempt_questions (attempt_id,question_id,position,section,subject,topic,difficulty,positive_marks,negative_marks) VALUES (?,?,?,?,?,?,?,?,?)',
        ).bind(
          attempt.id,
          questionId,
          index + 1,
          question.subject,
          question.subject,
          question.topic,
          difficulty,
          config.positiveMarks,
          config.negativeMarks,
        ),
        context.env.DB.prepare(
          'INSERT INTO attempt_responses (attempt_id,question_id,selected_option_index,marked_for_review,visited,client_elapsed_seconds,client_revision) VALUES (?,?,NULL,0,0,0,0)',
        ).bind(attempt.id, questionId),
      );
    }
    const comparable = await sha256(
      JSON.stringify({
        exam: config.slug,
        tier: request.tierStage,
        count: row.question_count,
        difficulty: request.difficulty,
        subject: request.subject,
        duration: row.duration_seconds,
        positive: config.positiveMarks,
        negative: config.negativeMarks,
        version: config.promptVersion,
      }),
    );
    const startedAt = new Date();
    const expiresAt = new Date(startedAt.getTime() + row.duration_seconds * 1000);
    statements.push(
      context.env.DB.prepare(
        `UPDATE attempts SET generation_status='ready',generation_error=NULL,status='active',
            comparison_key=?,started_at=?,expires_at=? WHERE id=?`,
      ).bind(comparable, startedAt.toISOString(), expiresAt.toISOString(), attempt.id),
      context.env.DB.prepare(
        `UPDATE generation_runs
            SET active_key=NULL,state='ready',stage='ready',status='completed',accepted_count=?,
                rejected_count=?,estimated_cost_usd=?,completed_at=?,cooldown_until=NULL,
                retry_stage=NULL,failed_stage=NULL,failure_recoverable=0,state_updated_at=?,
                lock_stage=NULL,lock_token=NULL,lock_expires_at=NULL
          WHERE attempt_id=? AND lock_token=?`,
      ).bind(
        accepted.length,
        rejectedCount,
        Number((totalInputTokens * 0.00000059 + totalOutputTokens * 0.00000079).toFixed(6)),
        createdAt,
        createdAt,
        attempt.id,
        lockToken,
      ),
    );
    if (snapshot.generationInputTokens + snapshot.generationOutputTokens > 0)
      statements.push(
        context.env.DB.prepare(
          `INSERT INTO ai_usage_logs (id,visitor_number,feature,model,status,input_tokens,output_tokens,created_at) VALUES (?,?, 'test_generation',?,'served',?,?,?)`,
        ).bind(
          crypto.randomUUID(),
          attempt.visitor_number,
          variables.GROQ_MODEL,
          snapshot.generationInputTokens,
          snapshot.generationOutputTokens,
          createdAt,
        ),
      );
    if (snapshot.verificationInputTokens + snapshot.verificationOutputTokens > 0)
      statements.push(
        context.env.DB.prepare(
          `INSERT INTO ai_usage_logs (id,visitor_number,feature,model,status,input_tokens,output_tokens,created_at) VALUES (?,?, 'test_verification',?,'served',?,?,?)`,
        ).bind(
          crypto.randomUUID(),
          attempt.visitor_number,
          variables.GROQ_VERIFICATION_MODEL,
          snapshot.verificationInputTokens,
          snapshot.verificationOutputTokens,
          createdAt,
        ),
      );
    await context.env.DB.batch(statements);
    console.log(
      JSON.stringify({
        event: 'ai_generation_transition',
        attemptId: attempt.id,
        previousState: runState.state,
        nextState: 'ready',
        stage: 'verification',
      }),
    );
    return context.json({
      attemptId: attempt.id,
      questionCount: accepted.length,
      durationSeconds: row.duration_seconds,
      startedAt: startedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      generationStatus: 'ready',
      status: 'ready',
      stage: stageLabels.ready,
    });
  } catch (error) {
    if (error instanceof AiRateLimitedError) {
      const resumeAfterSeconds = error.model
        ? Math.min(error.retryAfterSeconds, variables.AI_CLIENT_RETRY_SECONDS)
        : error.retryAfterSeconds;
      const cooldownUntil = new Date(Date.now() + resumeAfterSeconds * 1_000).toISOString();
      await context.env.DB.batch([
        context.env.DB.prepare(
          `UPDATE attempts SET generation_status=?,generation_error=? WHERE id=?`,
        ).bind(
          error.stage === 'verification' ? 'verifying' : 'generating',
          'AI provider cooldown is active.',
          attempt.id,
        ),
        context.env.DB.prepare(
          `UPDATE generation_runs
              SET state='rate_limited',stage='rate_limited',status='running',cooldown_until=?,
                  retry_stage=?,failed_stage=?,failure_recoverable=1,state_updated_at=?,
                  error_summary='AI provider cooldown is active.',lock_stage=NULL,
                  lock_token=NULL,lock_expires_at=NULL
            WHERE attempt_id=? AND lock_token=?`,
        ).bind(
          cooldownUntil,
          error.stage,
          error.stage,
          new Date().toISOString(),
          attempt.id,
          lockToken,
        ),
      ]);
      console.log(
        JSON.stringify({
          event: 'ai_generation_transition',
          attemptId: attempt.id,
          previousState: runState.state,
          nextState: 'rate_limited',
          stage: error.stage,
        }),
      );
      return context.json(rateLimitPayload(error.stage, resumeAfterSeconds), 429);
    }
    if (automaticRetry) {
      const retryMessage = 'Automatic retry failed. The saved attempt can be retried manually.';
      await context.env.DB.batch([
        context.env.DB.prepare(
          `UPDATE attempts SET generation_status=?,generation_error=? WHERE id=?`,
        ).bind(workStage === 'verification' ? 'verifying' : 'generating', retryMessage, attempt.id),
        context.env.DB.prepare(
          `UPDATE generation_runs
              SET state='retryable',stage='retryable',status='running',retry_stage=?,
                  failed_stage=?,failure_recoverable=1,error_summary=?,state_updated_at=?,
                  lock_stage=NULL,lock_token=NULL,lock_expires_at=NULL
            WHERE attempt_id=? AND lock_token=?`,
        ).bind(workStage, workStage, retryMessage, new Date().toISOString(), attempt.id, lockToken),
      ]);
      console.log(
        JSON.stringify({
          event: 'ai_generation_transition',
          attemptId: attempt.id,
          previousState: runState.state,
          nextState: 'retryable',
          stage: workStage,
        }),
      );
      return context.json(
        {
          error: retryMessage,
          errorCode: 'AI_RETRY_FAILED',
          status: 'retryable',
          stage: workStage,
          recoverable: true,
        },
        503,
      );
    }
    const invalidResponse = error instanceof AiResponseInvalidError;
    const message = invalidResponse
      ? 'AI provider returned invalid structured data.'
      : error instanceof Error
        ? error.message
        : 'Generation failed.';
    const errorCode = invalidResponse ? error.code : undefined;
    const errorStage = invalidResponse ? error.stage : undefined;
    const terminal = message.includes('exhausted') && snapshot.round >= maxGenerationRounds;
    const nextState: GenerationRunStateName = terminal ? 'invalid' : 'retryable';
    const timestamp = new Date().toISOString();
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE attempts SET generation_status=?,generation_error=?,
            status=CASE WHEN ?=1 THEN 'abandoned' ELSE status END WHERE id=?`,
      ).bind(
        terminal ? 'failed' : attemptGenerationStatus(nextState),
        message,
        terminal ? 1 : 0,
        attempt.id,
      ),
      context.env.DB.prepare(
        `UPDATE generation_runs
            SET active_key=CASE WHEN ?=1 THEN NULL ELSE active_key END,state=?,stage=?,status=?,
                failed_stage=?,failure_recoverable=?,rejected_count=?,error_summary=?,
                completed_at=CASE WHEN ?=1 THEN ? ELSE NULL END,state_updated_at=?,
                lock_stage=NULL,lock_token=NULL,lock_expires_at=NULL
          WHERE attempt_id=? AND lock_token=?`,
      ).bind(
        terminal ? 1 : 0,
        nextState,
        nextState,
        terminal ? 'exhausted' : 'running',
        workStage,
        terminal ? 0 : 1,
        rejectedCount,
        message,
        terminal ? 1 : 0,
        timestamp,
        timestamp,
        attempt.id,
        lockToken,
      ),
    ]);
    console.log(
      JSON.stringify({
        event: 'ai_generation_transition',
        attemptId: attempt.id,
        previousState: runState.state,
        nextState,
        stage: workStage,
      }),
    );
    return context.json(
      {
        error: message,
        errorCode: terminal ? 'GENERATION_EXHAUSTED' : (errorCode ?? 'AI_GENERATION_RETRYABLE'),
        status: nextState,
        stage: errorStage ?? workStage,
        recoverable: !terminal,
      },
      terminal ? 409 : 503,
    );
  }
});

export { routes as aiAssessmentRoutes };
