import {
  examinationPatternSchema,
  hostnameMatchesAuthority,
  isAllowedQuestionTransition,
  noteSchema,
  structuredQuestionSchema,
} from '@shared/content';
import { describe, expect, it } from 'vitest';

describe('verified content rules', () => {
  it('accepts exact and subdomain authority URLs but blocks lookalikes and HTTP', () => {
    expect(hostnameMatchesAuthority('https://ssc.gov.in/', ['ssc.gov.in'])).toBe(true);
    expect(hostnameMatchesAuthority('https://www.ssc.gov.in/path', ['ssc.gov.in'])).toBe(true);
    expect(hostnameMatchesAuthority('https://ssc.gov.in.evil.test/', ['ssc.gov.in'])).toBe(false);
    expect(hostnameMatchesAuthority('http://ssc.gov.in/', ['ssc.gov.in'])).toBe(false);
  });

  it('allows review progression but not imported to published', () => {
    expect(isAllowedQuestionTransition('imported', 'needs_review')).toBe(true);
    expect(isAllowedQuestionTransition('imported', 'published')).toBe(false);
    expect(isAllowedQuestionTransition('verified_official', 'published')).toBe(true);
  });

  it('requires exactly four MCQ options', () => {
    const base = {
      examinationSlug: 'ssc-cgl',
      qualificationLevel: 'graduate',
      tierStage: 'Tier I',
      year: 2025,
      section: 'General',
      subject: 'Reasoning',
      topic: 'Analogy',
      difficulty: 'unrated',
      questionText: 'A sufficiently long source question?',
      positiveMarks: 2,
      negativeMarks: 0.5,
      sourcePage: 1,
      language: 'en',
      contentOrigin: 'official_pyq',
    };
    expect(structuredQuestionSchema.safeParse({ ...base, options: ['A', 'B', 'C'] }).success).toBe(
      false,
    );
    expect(
      structuredQuestionSchema.safeParse({ ...base, options: ['A', 'B', 'C', 'D'] }).success,
    ).toBe(true);
  });

  it('requires pattern section totals and note citations', () => {
    const pattern = {
      examinationSlug: 'ssc-cgl',
      tierStage: 'Tier I',
      version: '2025',
      subjects: ['Reasoning'],
      sections: [
        { name: 'General', subjects: ['Reasoning'], questionCount: 10, marksPerQuestion: 2 },
      ],
      totalQuestions: 11,
      totalMarks: 20,
      marksPerQuestion: 2,
      negativeMarking: 0.5,
      standardDurationMinutes: 60,
      languageRules: {},
      navigationRules: {},
      qualificationStages: ['Tier I'],
      officialSourceId: crypto.randomUUID(),
      effectiveFrom: '2025-01-01',
      verificationStatus: 'needs_review',
    };
    expect(examinationPatternSchema.safeParse(pattern).success).toBe(false);
    expect(
      noteSchema.safeParse({
        examinationSlug: 'ssc-cgl',
        subject: 'Reasoning',
        topic: 'Analogy',
        title: 'Analogy notes',
        summaryMarkdown: 'A sufficiently long editorial summary.',
        language: 'en',
        citations: [],
      }).success,
    ).toBe(false);
  });
});
