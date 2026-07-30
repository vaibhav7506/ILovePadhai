import {
  aiExamConfigurations, aiTestRequestSchema, buildGenerationPrompt,
  deterministicArithmeticAnswer, deterministicQuestionIssues, generatedBatchSchema,
  optionIndependentText, tokenSimilarity, type GeneratedQuestion,
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
    expect(() => generatedBatchSchema.parse({ questions: [{ ...question, options: ['1', '2', '3'] }] })).toThrow();
    expect(aiTestRequestSchema.parse({
      visitorUuid: '77a0fb6a-44d5-41ea-8d30-e9748995c9f9',
      examinationSlug: 'ssc-chsl', tierStage: 'Tier I', subject: 'Quantitative Aptitude',
      topic: null, difficulty: 'medium', questionCount: 10, fullMock: false,
      language: 'en', timerMode: 'custom', customDurationMinutes: 10,
    }).questionCount).toBe(10);
  });

  it('detects duplicate options, reordered copies, and similar text', () => {
    expect(deterministicQuestionIssues({ ...question, options: ['20', '20!', '19', '18'] })).toContain('Options must be meaningfully distinct.');
    expect(optionIndependentText(question)).toBe(optionIndependentText({ ...question, options: [...question.options].reverse() }));
    expect(tokenSimilarity(question.question, 'Using the standard addition rule, calculate 12 + 8.')).toBeGreaterThan(0.5);
  });

  it('checks simple arithmetic deterministically', () => {
    expect(deterministicArithmeticAnswer(question)).toBe(true);
    expect(deterministicArithmeticAnswer({ ...question, correctOptionIndex: 0 })).toBe(false);
  });

  it('uses exam-specific constraints and exclusions', () => {
    const config = aiExamConfigurations.find((item) => item.slug === 'ssc-chsl')!;
    const input = aiTestRequestSchema.parse({
      visitorUuid: '77a0fb6a-44d5-41ea-8d30-e9748995c9f9',
      examinationSlug: 'ssc-chsl', tierStage: 'Tier I', subject: 'Quantitative Aptitude',
      topic: 'Percentages', difficulty: 'medium', questionCount: 10, fullMock: false,
      language: 'en', timerMode: 'custom', customDurationMinutes: 10,
    });
    const prompt = buildGenerationPrompt(config, input, 10, ['seen-fingerprint'], 'seed');
    expect(prompt).toContain('PROMPT_VERSION=ssc-chsl-v1');
    expect(prompt).toContain('Required count: 10');
    expect(prompt).toContain('seen-fingerprint');
  });
});
