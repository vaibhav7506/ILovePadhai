import {
  aiExamConfigurations,
  aiTestRequestSchema,
  buildGenerationPrompt,
  compactVerificationPayload,
  decideGenerationAction,
  deterministicArithmeticAnswer,
  deterministicQuestionIssues,
  generatedBatchSchema,
  generationBatchCount,
  generationBatchSize,
  groqGenerationFallbackModels,
  groqMaxTokens,
  groqModelForStage,
  normaliseQuestion,
  parseGenerationContent,
  parseRetryAfterSeconds,
  parseVerificationContent,
  requireVerificationCoverage,
  selectAvailableGroqModel,
  shouldAutomaticallyRetry,
  optionIndependentText,
  tokenSimilarity,
  type GeneratedQuestion,
} from '@shared/ai-assessment';
import { describe, expect, it } from 'vitest';

const question: GeneratedQuestion = {
  question: 'Calculate 12 + 8 using the standard addition rule.',
  options: ['18', '19', '20', '21'],
  correctOptionIndex: 2,
  explanation: 'Adding twelve and eight produces the correct option 20.',
  subject: 'Quantitative Aptitude',
  topic: 'Number System',
  difficulty: 'medium',
  language: 'en',
  verificationMethod: 'model_review',
};

describe('AI assessment architecture', () => {
  it('stores six distinct versioned exam templates', () => {
    expect(aiExamConfigurations).toHaveLength(6);
    expect(new Set(aiExamConfigurations.map((item) => item.promptVersion)).size).toBe(6);
  });

  it('validates exactly four options and a 10-question configuration', () => {
    expect(generatedBatchSchema.parse({ questions: [question] }).questions).toHaveLength(1);
    expect(() =>
      generatedBatchSchema.parse({ questions: [{ ...question, options: ['1', '2', '3'] }] }),
    ).toThrow();
    expect(
      aiTestRequestSchema.parse({
        visitorUuid: '77a0fb6a-44d5-41ea-8d30-e9748995c9f9',
        examinationSlug: 'ssc-chsl',
        tierStage: 'Tier I',
        subject: 'Quantitative Aptitude',
        topic: null,
        difficulty: 'medium',
        questionCount: 10,
        fullMock: false,
        language: 'en',
        timerMode: 'custom',
        customDurationMinutes: 10,
      }).questionCount,
    ).toBe(10);
  });

  it('detects duplicate options, reordered copies, and similar text', () => {
    expect(
      deterministicQuestionIssues({ ...question, options: ['20', '20!', '19', '18'] }),
    ).toContain('Options must be meaningfully distinct.');
    expect(optionIndependentText(question)).toBe(
      optionIndependentText({ ...question, options: [...question.options].reverse() }),
    );
    expect(
      tokenSimilarity(question.question, 'Using the standard addition rule, calculate 12 + 8.'),
    ).toBeGreaterThan(0.5);
  });

  it('checks simple arithmetic deterministically', () => {
    expect(deterministicArithmeticAnswer(question)).toBe(true);
    expect(deterministicArithmeticAnswer({ ...question, correctOptionIndex: 0 })).toBe(false);
  });

  it('uses exam-specific constraints and exclusions', () => {
    const config = aiExamConfigurations.find((item) => item.slug === 'ssc-chsl');
    expect(config).toBeDefined();
    if (!config) throw new Error('SSC CHSL configuration missing.');
    const input = aiTestRequestSchema.parse({
      visitorUuid: '77a0fb6a-44d5-41ea-8d30-e9748995c9f9',
      examinationSlug: 'ssc-chsl',
      tierStage: 'Tier I',
      subject: 'Quantitative Aptitude',
      topic: 'Percentages',
      difficulty: 'medium',
      questionCount: 10,
      fullMock: false,
      language: 'en',
      timerMode: 'custom',
      customDurationMinutes: 10,
    });
    const prompt = buildGenerationPrompt(config, input, 10, 'seed');
    expect(prompt).toContain('VERSION=ssc-chsl-v1');
    expect(prompt).toContain('COUNT=5');
    expect(prompt).not.toContain('seen-fingerprint');
  });
});

describe('Groq response parsing', () => {
  const verification = {
    questionId: 'question-stable-1',
    status: 'verified' as const,
    confidence: 0.95,
    correctedOptionIndex: null,
    rejectionReason: null,
  };

  it('accepts the canonical verification results object', () => {
    expect(parseVerificationContent(JSON.stringify({ results: [verification] })).results).toEqual([
      verification,
    ]);
  });

  it('normalises a bare verification array', () => {
    expect(parseVerificationContent(JSON.stringify([verification])).results).toEqual([
      verification,
    ]);
  });

  it('normalises the known verifications wrapper', () => {
    expect(
      parseVerificationContent(JSON.stringify({ verifications: [verification] })).results,
    ).toEqual([verification]);
  });

  it('removes Markdown JSON fences before validation', () => {
    expect(
      parseVerificationContent(`\`\`\`json\n${JSON.stringify({ results: [verification] })}\n\`\`\``)
        .results,
    ).toHaveLength(1);
  });

  it('rejects missing results and invalid JSON', () => {
    expect(() => parseVerificationContent('{"answer":"verified"}')).toThrow();
    expect(() => parseVerificationContent('not json')).toThrow(
      'AI response content was not valid JSON.',
    );
  });

  it('rejects verification count or stable-ID mismatches', () => {
    const batch = parseVerificationContent(JSON.stringify({ results: [verification] }));
    expect(() =>
      requireVerificationCoverage(batch, ['question-stable-1', 'question-stable-2']),
    ).toThrow('Verification result count does not match');
    expect(() => requireVerificationCoverage(batch, ['different-id'])).toThrow(
      'Verification result IDs do not match',
    );
  });

  it('parses an exact five-question generation response', () => {
    const questions = Array.from({ length: 5 }, (_, index) => ({
      question: `Calculate 12 + ${String(index + 8)} using the standard addition rule.`,
      options: question.options,
      correctOptionIndex: question.correctOptionIndex,
      explanation: question.explanation,
      subject: question.subject,
      topic: question.topic,
    }));
    expect(parseGenerationContent(JSON.stringify({ questions })).questions).toHaveLength(5);
  });

  it('rejects provider batches over five and explanations over forty words', () => {
    const providerQuestion = {
      question: question.question,
      options: question.options,
      correctOptionIndex: question.correctOptionIndex,
      explanation: Array.from({ length: 41 }, () => 'word').join(' '),
      subject: question.subject,
      topic: question.topic,
    };
    expect(() => parseGenerationContent(JSON.stringify({ questions: [providerQuestion] }))).toThrow(
      'Explanation must not exceed 40 words.',
    );
    expect(() =>
      parseGenerationContent(
        JSON.stringify({
          questions: Array.from({ length: 6 }, () => ({
            ...providerQuestion,
            explanation: question.explanation,
          })),
        }),
      ),
    ).toThrow();
  });
});

describe('Groq rate-limit architecture', () => {
  it('uses separate generation and verification models', () => {
    expect(groqModelForStage('generation', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b')).toBe(
      'llama-3.3-70b-versatile',
    );
    expect(groqModelForStage('verification', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b')).toBe(
      'openai/gpt-oss-20b',
    );
  });

  it('builds a compact verification payload without visitor or product data', () => {
    const payload = compactVerificationPayload([{ questionId: 'stable-question', question }]);
    expect(Object.keys(payload.questions[0] ?? {})).toEqual([
      'questionId',
      'question',
      'options',
      'proposedAnswer',
      'topic',
      'explanation',
    ]);
    expect(JSON.stringify(payload)).not.toMatch(
      /visitor|leaderboard|cutoff|ExamForge|correctOptionIndex/i,
    );
  });

  it('parses numeric and HTTP-date retry-after headers', () => {
    expect(parseRetryAfterSeconds('2.2')).toBe(3);
    expect(
      parseRetryAfterSeconds(
        'Thu, 30 Jul 2026 12:00:05 GMT',
        Date.parse('Thu, 30 Jul 2026 12:00:00 GMT'),
      ),
    ).toBe(5);
    expect(parseRetryAfterSeconds(null)).toBe(60);
  });

  it('exposes cooldown eligibility for one automatic retry', () => {
    const elapsed = new Date(Date.now() - 1_000).toISOString();
    const future = new Date(Date.now() + 30_000).toISOString();
    expect(shouldAutomaticallyRetry(elapsed, false)).toBe(true);
    expect(shouldAutomaticallyRetry(elapsed, true)).toBe(false);
    expect(shouldAutomaticallyRetry(future, false)).toBe(false);
  });

  it('always bounds provider output tokens by stage and question count', () => {
    expect(groqMaxTokens('generation', 1)).toBe(700);
    expect(groqMaxTokens('generation', 5)).toBe(2_200);
    expect(groqMaxTokens('generation', 200)).toBe(2_200);
    expect(groqMaxTokens('verification', 1)).toBe(380);
    expect(groqMaxTokens('verification', 5)).toBe(1_100);
    expect(groqMaxTokens('verification', 200)).toBe(1_100);
    expect(groqMaxTokens('generation', 5, 1_800, 1_000)).toBe(1_800);
    expect(groqMaxTokens('verification', 5, 1_800, 1_000)).toBe(1_000);
  });

  it('uses exactly two sequential generation batches for ten questions', () => {
    expect(generationBatchSize(10, 5)).toBe(5);
    expect(generationBatchSize(5, 5)).toBe(5);
    expect(generationBatchCount(10, 5)).toBe(2);
  });

  it('batches all uncertain questions into one compact verification payload', () => {
    const candidates = Array.from({ length: 5 }, (_, index) => ({
      questionId: `question-${String(index)}`,
      question: { ...question, question: `${question.question} ${String(index)}` },
    }));
    const payload = compactVerificationPayload(candidates);
    expect(payload.questions).toHaveLength(5);
    expect(Object.keys(payload)).toEqual(['questions']);
  });

  it('skips cooling models in fallback order without duplicating model entries', () => {
    const models = groqGenerationFallbackModels('llama-3.3-70b-versatile');
    expect(models).toEqual([
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'openai/gpt-oss-20b',
    ]);
    expect(
      selectAvailableGroqModel(
        models,
        { 'llama-3.3-70b-versatile': '2026-08-01T12:01:00.000Z' },
        Date.parse('2026-08-01T12:00:00.000Z'),
      ),
    ).toEqual({ model: 'llama-3.1-8b-instant', fallbackDecision: 'fallback:llama-3.1-8b-instant' });
    const persistedHashes = new Set([normaliseQuestion(question.question)]);
    expect(
      persistedHashes.has(normaliseQuestion('Calculate 12 + 8, using the standard addition rule!')),
    ).toBe(true);
  });
});

describe('idempotent generation state machine', () => {
  const now = Date.parse('2026-08-01T12:00:00.000Z');

  it('starts pending work and resumes the exact failed stage', () => {
    expect(
      decideGenerationAction(
        { state: 'pending', failedStage: null, cooldownUntil: null, lockExpiresAt: null },
        now,
      ),
    ).toEqual({ action: 'run', stage: 'generation' });
    expect(
      decideGenerationAction(
        {
          state: 'retryable',
          failedStage: 'verification',
          cooldownUntil: null,
          lockExpiresAt: null,
        },
        now,
      ),
    ).toEqual({ action: 'run', stage: 'verification' });
  });

  it('rejects duplicate provider work while a database lease is active', () => {
    expect(
      decideGenerationAction(
        {
          state: 'generating',
          failedStage: null,
          cooldownUntil: null,
          lockExpiresAt: '2026-08-01T12:00:02.000Z',
        },
        now,
      ),
    ).toEqual({ action: 'already_running', retryAfterSeconds: 2 });
  });

  it('reclaims an expired generation or verification lease after a Worker restart', () => {
    expect(
      decideGenerationAction(
        {
          state: 'generating',
          failedStage: null,
          cooldownUntil: null,
          lockExpiresAt: '2026-08-01T11:59:59.000Z',
        },
        now,
      ),
    ).toEqual({ action: 'run', stage: 'generation' });
    expect(
      decideGenerationAction(
        {
          state: 'verification_pending',
          failedStage: null,
          cooldownUntil: null,
          lockExpiresAt: null,
        },
        now,
      ),
    ).toEqual({ action: 'run', stage: 'verification' });
  });

  it('preserves generation and verification cooldown stages on the same attempt', () => {
    expect(
      decideGenerationAction(
        {
          state: 'rate_limited',
          failedStage: 'generation',
          cooldownUntil: '2026-08-01T12:00:10.000Z',
          lockExpiresAt: null,
        },
        now,
      ),
    ).toEqual({ action: 'rate_limited', stage: 'generation', retryAfterSeconds: 10 });
    expect(
      decideGenerationAction(
        {
          state: 'rate_limited',
          failedStage: 'verification',
          cooldownUntil: '2026-08-01T11:59:59.000Z',
          lockExpiresAt: null,
        },
        now,
      ),
    ).toEqual({ action: 'run', stage: 'verification' });
  });

  it('returns ready idempotently and structured terminal conflicts', () => {
    expect(
      decideGenerationAction(
        { state: 'ready', failedStage: null, cooldownUntil: null, lockExpiresAt: null },
        now,
      ),
    ).toEqual({ action: 'ready' });
    expect(
      decideGenerationAction(
        { state: 'invalid', failedStage: null, cooldownUntil: null, lockExpiresAt: null },
        now,
      ),
    ).toEqual({ action: 'terminal', errorCode: 'ATTEMPT_INVALID' });
  });
});
