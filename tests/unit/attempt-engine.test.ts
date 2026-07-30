import { createAttemptSchema } from '@shared/attempt';
import { selectQuestions } from '@shared/attempt-selection';
import { signAttemptToken, verifyAttemptToken } from '@shared/attempt-token';
import { calculateScore } from '@shared/scoring';
import { describe, expect, it } from 'vitest';

const candidate = (id: string, section: string, subject: string, overrides = {}) => ({
  id,
  document_id: 'doc-2025-shift-1',
  section,
  subject,
  topic: `${subject} topic`,
  difficulty: 'moderate',
  year: 2025,
  exam_date: '2025-06-01',
  shift: 'Shift 1',
  content_origin: 'official_pyq',
  positive_marks: 2,
  negative_marks: 0.5,
  ...overrides,
});

const pattern = {
  id: 'pattern',
  sections_json: JSON.stringify([
    { name: 'Reasoning', subjects: ['Reasoning'], questionCount: 2, marksPerQuestion: 2 },
    { name: 'English', subjects: ['English'], questionCount: 2, marksPerQuestion: 2 },
  ]),
  subjects_json: JSON.stringify(['Reasoning', 'English']),
  total_questions: 4,
  standard_duration_minutes: 60,
};

const candidates = [
  candidate('r1', 'Reasoning', 'Reasoning'),
  candidate('r2', 'Reasoning', 'Reasoning'),
  candidate('e1', 'English', 'English'),
  candidate('e2', 'English', 'English'),
];

describe('attempt mode selection', () => {
  it('derives standard and diagnostic duration from the verified pattern', () => {
    const standard = selectQuestions(candidates, pattern, {
      visitorUuid: crypto.randomUUID(),
      examinationSlug: 'ssc-cgl',
      tierStage: 'Tier I',
      mode: 'standard',
    });
    expect(standard.questions.map((question) => question.id)).toEqual(['r1', 'r2', 'e1', 'e2']);
    expect(standard.durationSeconds).toBe(3600);

    const diagnostic = selectQuestions(candidates, pattern, {
      visitorUuid: crypto.randomUUID(),
      examinationSlug: 'ssc-cgl',
      tierStage: 'Tier I',
      mode: 'diagnostic',
    });
    expect(diagnostic.questions.map((question) => question.id)).toEqual(['r1', 'e1', 'r2', 'e2']);
    expect(diagnostic.durationSeconds).toBe(2700);
  });

  it('supports filtered custom practice and one source paper', () => {
    const custom = selectQuestions(candidates, pattern, {
      visitorUuid: crypto.randomUUID(),
      examinationSlug: 'ssc-cgl',
      tierStage: 'Tier I',
      mode: 'custom',
      custom: {
        subject: 'Reasoning',
        origins: ['official_pyq'],
        questionCount: 2,
        durationMinutes: 15,
        weakQuestionsOnly: false,
      },
    });
    expect(custom.questions).toHaveLength(2);
    expect(custom.durationSeconds).toBe(900);

    const previousYear = selectQuestions(candidates, pattern, {
      visitorUuid: crypto.randomUUID(),
      examinationSlug: 'ssc-cgl',
      tierStage: 'Tier I',
      mode: 'previous_year',
      previousYear: { year: 2025, shift: 'Shift 1' },
    });
    expect(previousYear.questions).toHaveLength(4);
  });
});

describe('server scoring and token integrity', () => {
  it('calculates positive, negative, unattempted, section and topic metrics', () => {
    const score = calculateScore(
      [
        {
          id: '1',
          section: 'A',
          topic: 'One',
          positiveMarks: 2,
          negativeMarks: 0.5,
          correctOptionIndex: 1,
          selectedOptionIndex: 1,
          timeSpentSeconds: 10,
        },
        {
          id: '2',
          section: 'A',
          topic: 'Two',
          positiveMarks: 2,
          negativeMarks: 0.5,
          correctOptionIndex: 0,
          selectedOptionIndex: 3,
          timeSpentSeconds: 12,
        },
        {
          id: '3',
          section: 'B',
          topic: 'Three',
          positiveMarks: 2,
          negativeMarks: 0.5,
          correctOptionIndex: 2,
          selectedOptionIndex: null,
          timeSpentSeconds: 0,
        },
      ],
      90,
    );
    expect(score).toMatchObject({
      correct: 1,
      incorrect: 1,
      unattempted: 1,
      rawScore: 2,
      negativeMarks: 0.5,
      finalScore: 1.5,
      accuracy: 50,
      averageTimePerQuestionSeconds: 30,
    });
    expect(score.sections.A?.score).toBe(1.5);
  });

  it('rejects tampered attempt tokens', async () => {
    const secret = 'a-secure-test-secret-with-more-than-32-characters';
    const payload = {
      attemptId: crypto.randomUUID(),
      visitorNumber: 12,
      issuedAt: 1_785_542_400,
      nonce: crypto.randomUUID(),
    };
    const token = await signAttemptToken(payload, secret);
    await expect(verifyAttemptToken(token, secret)).resolves.toEqual(payload);
    const [encodedPayload = '', signature = ''] = token.split('.');
    const changedSignature = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
    await expect(
      verifyAttemptToken(`${encodedPayload}.${changedSignature}`, secret),
    ).resolves.toBeNull();
  });

  it('requires mode-specific settings at the API boundary', () => {
    expect(
      createAttemptSchema.safeParse({
        visitorUuid: crypto.randomUUID(),
        examinationSlug: 'ssc-cgl',
        tierStage: 'Tier I',
        mode: 'custom',
      }).success,
    ).toBe(false);
  });
});
