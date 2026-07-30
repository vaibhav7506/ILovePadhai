import { z } from 'zod';

export const aiDifficulties = ['easy', 'medium', 'hard', 'mixed'] as const;
export const aiLanguages = ['en', 'hi'] as const;

export interface AiExamConfiguration {
  slug: string;
  name: string;
  level: 'secondary' | 'graduate';
  tiers: readonly string[];
  subjects: Readonly<Record<string, readonly string[]>>;
  defaultDifficulty: (typeof aiDifficulties)[number];
  standardQuestions: number;
  standardDurationMinutes: number;
  positiveMarks: number;
  negativeMarks: number;
  languages: readonly (typeof aiLanguages)[number][];
  cutoffDimensions: readonly ('category' | 'post' | 'region')[];
  promptVersion: string;
  promptInstructions: string;
}

const commonSscSubjects = {
  'Quantitative Aptitude': [
    'Number System',
    'Percentages',
    'Ratio and Proportion',
    'Average',
    'Profit and Loss',
  ],
  Reasoning: ['Analogy', 'Series', 'Coding-Decoding', 'Classification', 'Syllogism'],
  'General Awareness': ['History', 'Geography', 'Polity', 'Economics', 'General Science'],
  English: ['Grammar', 'Vocabulary', 'Comprehension', 'Sentence Improvement'],
} as const;

export const aiExamConfigurations: readonly AiExamConfiguration[] = [
  {
    slug: 'ssc-mts',
    name: 'SSC MTS',
    level: 'secondary',
    tiers: ['Session I & II'],
    subjects: commonSscSubjects,
    defaultDifficulty: 'medium',
    standardQuestions: 90,
    standardDurationMinutes: 90,
    positiveMarks: 3,
    negativeMarks: 1,
    languages: ['en', 'hi'],
    cutoffDimensions: ['category', 'region'],
    promptVersion: 'ssc-mts-v1',
    promptInstructions:
      'Follow SSC MTS matriculation-level syllabus and concise computer-based-test style.',
  },
  {
    slug: 'ssc-gd',
    name: 'SSC GD Constable',
    level: 'secondary',
    tiers: ['Computer Based Examination'],
    subjects: commonSscSubjects,
    defaultDifficulty: 'medium',
    standardQuestions: 80,
    standardDurationMinutes: 60,
    positiveMarks: 2,
    negativeMarks: 0.25,
    languages: ['en', 'hi'],
    cutoffDimensions: ['category', 'region'],
    promptVersion: 'ssc-gd-v1',
    promptInstructions:
      'Follow SSC GD matriculation-level CBT syllabus; avoid specialist graduate-level material.',
  },
  {
    slug: 'ssc-chsl',
    name: 'SSC CHSL',
    level: 'secondary',
    tiers: ['Tier I'],
    subjects: commonSscSubjects,
    defaultDifficulty: 'medium',
    standardQuestions: 100,
    standardDurationMinutes: 60,
    positiveMarks: 2,
    negativeMarks: 0.5,
    languages: ['en', 'hi'],
    cutoffDimensions: ['category', 'post'],
    promptVersion: 'ssc-chsl-v1',
    promptInstructions:
      'Follow SSC CHSL higher-secondary Tier-I syllabus and authentic objective-test reasoning style.',
  },
  {
    slug: 'ssc-cgl',
    name: 'SSC CGL',
    level: 'graduate',
    tiers: ['Tier I'],
    subjects: commonSscSubjects,
    defaultDifficulty: 'medium',
    standardQuestions: 100,
    standardDurationMinutes: 60,
    positiveMarks: 2,
    negativeMarks: 0.5,
    languages: ['en', 'hi'],
    cutoffDimensions: ['category', 'post'],
    promptVersion: 'ssc-cgl-v1',
    promptInstructions:
      'Follow SSC CGL graduate-level Tier-I syllabus with multi-step but unambiguous reasoning.',
  },
  {
    slug: 'ssc-cpo',
    name: 'SSC CPO',
    level: 'graduate',
    tiers: ['Paper I'],
    subjects: commonSscSubjects,
    defaultDifficulty: 'medium',
    standardQuestions: 200,
    standardDurationMinutes: 120,
    positiveMarks: 1,
    negativeMarks: 0.25,
    languages: ['en', 'hi'],
    cutoffDimensions: ['category', 'post'],
    promptVersion: 'ssc-cpo-v1',
    promptInstructions:
      'Follow SSC CPO Paper-I graduate-level syllabus and police-recruitment examination style.',
  },
  {
    slug: 'rrb-ntpc-graduate',
    name: 'RRB NTPC Graduate',
    level: 'graduate',
    tiers: ['CBT 1'],
    subjects: {
      Mathematics: commonSscSubjects['Quantitative Aptitude'],
      'General Intelligence and Reasoning': commonSscSubjects.Reasoning,
      'General Awareness': commonSscSubjects['General Awareness'],
    },
    defaultDifficulty: 'medium',
    standardQuestions: 100,
    standardDurationMinutes: 90,
    positiveMarks: 1,
    negativeMarks: 1 / 3,
    languages: ['en', 'hi'],
    cutoffDimensions: ['category', 'region'],
    promptVersion: 'rrb-ntpc-graduate-v1',
    promptInstructions:
      'Follow RRB NTPC Graduate CBT-1 syllabus and railway-recruitment objective-test style.',
  },
] as const;

export const aiTestRequestSchema = z
  .object({
    visitorUuid: z.uuid(),
    examinationSlug: z.string().min(3).max(80),
    tierStage: z.string().min(1).max(80),
    subject: z.string().min(1).max(120).default('All subjects'),
    topic: z.string().min(1).max(120).nullable().default(null),
    difficulty: z.enum(aiDifficulties),
    questionCount: z
      .union([
        z.literal(5),
        z.literal(10),
        z.literal(15),
        z.literal(20),
        z.literal(25),
        z.literal(50),
      ])
      .nullable(),
    fullMock: z.boolean(),
    language: z.enum(aiLanguages),
    timerMode: z.enum(['standard', 'custom', 'untimed']),
    customDurationMinutes: z.number().int().min(1).max(240).nullable(),
    nickname: z.string().trim().min(2).max(24).optional(),
    category: z.string().min(1).max(80).optional(),
    post: z.string().min(1).max(160).optional(),
    region: z.string().min(1).max(160).optional(),
    turnstileToken: z.string().max(4096).optional(),
    allowRepetition: z.boolean().default(false),
  })
  .superRefine((value, context) => {
    if (!value.fullMock && value.questionCount === null)
      context.addIssue({
        code: 'custom',
        path: ['questionCount'],
        message: 'Choose a question count.',
      });
    if (value.timerMode === 'custom' && value.customDurationMinutes === null)
      context.addIssue({
        code: 'custom',
        path: ['customDurationMinutes'],
        message: 'Choose a custom duration.',
      });
  });

export const generatedQuestionSchema = z
  .object({
    question: z.string().trim().min(12).max(1200),
    options: z.array(z.string().trim().min(1).max(500)).length(4),
    correctOptionIndex: z.number().int().min(0).max(3),
    explanation: z.string().trim().min(8).max(1000),
    subject: z.string().trim().min(1).max(120),
    topic: z.string().trim().min(1).max(120),
    difficulty: z.enum(['easy', 'medium', 'hard']),
    language: z.enum(aiLanguages),
    verificationMethod: z.literal('model_review'),
  })
  .strict();
export const generatedBatchSchema = z
  .object({
    questions: z.array(generatedQuestionSchema).min(1).max(200),
  })
  .strict();

export const verificationItemSchema = z
  .object({
    questionId: z.string().min(1).max(120),
    status: z.enum(['verified', 'rejected', 'needs_deterministic_check']),
    confidence: z.number().min(0).max(1),
    correctedOptionIndex: z.number().int().min(0).max(3).nullable(),
    rejectionReason: z.string().trim().max(180).nullable(),
  })
  .strict();
export const verificationBatchSchema = z
  .object({ results: z.array(verificationItemSchema) })
  .strict();

export type AiTestRequest = z.infer<typeof aiTestRequestSchema>;
export type GeneratedQuestion = z.infer<typeof generatedQuestionSchema>;
export type VerificationBatch = z.infer<typeof verificationBatchSchema>;

export const generationResponseJsonSchema =
  '{"questions":[{"question":"string","options":["string","string","string","string"],"correctOptionIndex":0,"explanation":"approximately 40-60 words","subject":"string","topic":"string","difficulty":"easy|medium|hard","language":"en|hi","verificationMethod":"model_review"}]}';

export const verificationResponseJsonSchema =
  '{"results":[{"questionId":"input ID","status":"verified|rejected|needs_deterministic_check","correctedOptionIndex":null,"confidence":0.0,"rejectionReason":null}]}';

export interface VerificationCandidate {
  questionId: string;
  question: GeneratedQuestion;
}

export function compactVerificationPayload(candidates: readonly VerificationCandidate[]): {
  questions: {
    questionId: string;
    question: string;
    options: [string, string, string, string];
    proposedAnswer: number;
    topic: string;
    explanation: string;
  }[];
} {
  return {
    questions: candidates.map(({ questionId, question }) => ({
      questionId,
      question: question.question,
      options: question.options as [string, string, string, string],
      proposedAnswer: question.correctOptionIndex,
      topic: question.topic,
      explanation: question.explanation,
    })),
  };
}

export function groqMaxTokens(stage: 'generation' | 'verification', questionCount: number): number {
  const boundedCount = Math.max(1, Math.min(200, questionCount));
  return stage === 'generation'
    ? Math.min(6_000, Math.max(900, boundedCount * 420 + 300))
    : Math.min(2_400, Math.max(256, boundedCount * 110 + 160));
}

export function groqModelForStage(
  stage: 'generation' | 'verification',
  generationModel: string,
  verificationModel: string,
): string {
  return stage === 'generation' ? generationModel : verificationModel;
}

export function parseRetryAfterSeconds(value: string | null, nowMilliseconds = Date.now()): number {
  if (!value) return 60;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0)
    return Math.max(1, Math.min(3_600, Math.ceil(numeric)));
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return 60;
  return Math.max(1, Math.min(3_600, Math.ceil((date - nowMilliseconds) / 1_000)));
}

export function shouldAutomaticallyRetry(
  cooldownUntil: string | null,
  autoRetryUsed: boolean,
  nowMilliseconds = Date.now(),
): boolean {
  return (
    !autoRetryUsed &&
    cooldownUntil !== null &&
    Number.isFinite(Date.parse(cooldownUntil)) &&
    Date.parse(cooldownUntil) <= nowMilliseconds
  );
}

export function stripJsonFences(content: string): string {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return (fenced?.[1] ?? trimmed).trim();
}

function parseJsonContent(content: string): unknown {
  const clean = stripJsonFences(content);
  if (!clean) throw new Error('AI response content was empty.');
  try {
    return JSON.parse(clean) as unknown;
  } catch {
    throw new Error('AI response content was not valid JSON.');
  }
}

export function parseGenerationContent(content: string): z.infer<typeof generatedBatchSchema> {
  return generatedBatchSchema.parse(parseJsonContent(content));
}

export function normaliseVerificationShape(value: unknown): unknown {
  if (Array.isArray(value)) return { results: value };
  if (typeof value !== 'object' || value === null) return value;
  if (Object.hasOwn(value, 'results')) return value;
  if (Object.hasOwn(value, 'verifications')) {
    const verifications: unknown = Reflect.get(value, 'verifications');
    return { results: verifications };
  }
  return value;
}

export function parseVerificationContent(content: string): VerificationBatch {
  return verificationBatchSchema.parse(normaliseVerificationShape(parseJsonContent(content)));
}

export function requireVerificationCoverage(
  batch: VerificationBatch,
  questionIds: readonly string[],
): VerificationBatch {
  if (batch.results.length !== questionIds.length)
    throw new Error('Verification result count does not match generated question count.');
  const expected = new Set(questionIds);
  const actual = new Set(batch.results.map((item) => item.questionId));
  if (
    actual.size !== batch.results.length ||
    actual.size !== expected.size ||
    [...actual].some((questionId) => !expected.has(questionId))
  )
    throw new Error('Verification result IDs do not match generated question IDs.');
  return batch;
}

export function examConfiguration(slug: string): AiExamConfiguration | undefined {
  return aiExamConfigurations.find((exam) => exam.slug === slug);
}

export function normaliseQuestion(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenSimilarity(left: string, right: string): number {
  const a = new Set(
    normaliseQuestion(left)
      .split(' ')
      .filter((token) => token.length > 2),
  );
  const b = new Set(
    normaliseQuestion(right)
      .split(' ')
      .filter((token) => token.length > 2),
  );
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection);
}

export function optionIndependentText(question: GeneratedQuestion): string {
  return `${normaliseQuestion(question.question)}|${question.options.map(normaliseQuestion).sort().join('|')}`;
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const prohibited =
  /\b(as an ai|system prompt|generation instruction|refer to (the )?(image|passage|chart)|latest|current affairs today)\b/i;

export function deterministicQuestionIssues(question: GeneratedQuestion): string[] {
  const issues: string[] = [];
  const options = question.options.map(normaliseQuestion);
  if (new Set(options).size !== 4) issues.push('Options must be meaningfully distinct.');
  if (question.question.includes('___') || prohibited.test(question.question))
    issues.push('Question is incomplete, unstable, or depends on hidden context.');
  if (
    !normaliseQuestion(question.explanation).includes(
      normaliseQuestion(question.options[question.correctOptionIndex] ?? ''),
    ) &&
    question.explanation.length < 30
  )
    issues.push('Explanation does not substantiate the proposed answer.');
  return issues;
}

export function deterministicArithmeticAnswer(question: GeneratedQuestion): boolean | null {
  const expression =
    /(?:what is|calculate|evaluate)\s+(-?\d+(?:\.\d+)?)\s*([+\-*×÷/])\s*(-?\d+(?:\.\d+)?)/i.exec(
      question.question,
    );
  if (!expression) return null;
  const left = Number(expression[1]);
  const right = Number(expression[3]);
  const operator = expression[2];
  const expected =
    operator === '+'
      ? left + right
      : operator === '-'
        ? left - right
        : operator === '*' || operator === '×'
          ? left * right
          : right === 0
            ? Number.NaN
            : left / right;
  const selected = Number(
    /-?\d+(?:\.\d+)?/.exec(
      (question.options[question.correctOptionIndex] ?? '').replaceAll(',', ''),
    )?.[0],
  );
  return (
    Number.isFinite(expected) &&
    Number.isFinite(selected) &&
    Math.abs(expected - selected) < 0.000001
  );
}

export function buildGenerationPrompt(
  config: AiExamConfiguration,
  request: AiTestRequest,
  count: number,
  seen: readonly string[],
  seed: string,
): string {
  const topics =
    request.subject === 'All subjects'
      ? Object.entries(config.subjects)
          .map(([subject, values]) => `${subject}: ${values.join(', ')}`)
          .join('; ')
      : `${request.subject}: ${(config.subjects[request.subject] ?? []).join(', ')}`;
  return `VERSION=${config.promptVersion}\nSEED=${seed}\nEXAM=${config.name}\nTIER=${request.tierStage}\nSUBJECT=${request.subject}\nTOPIC=${request.topic ?? 'mixed'}\nDIFFICULTY=${request.difficulty}\nLANGUAGE=${request.language}\nCOUNT=${String(count)}\nSYLLABUS=${topics}\n${config.promptInstructions}\nWrite distinct four-option MCQs with exactly one correct answer. Explanations must be approximately 40–60 words. Reject ambiguity, unstable facts, hidden context and repeated templates. Avoid these prior fingerprints: ${seen.slice(-12).join(',') || 'none'}.\nReturn only JSON matching: ${generationResponseJsonSchema}`;
}
