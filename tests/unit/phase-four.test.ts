import { calculateReadiness, compareCutoff, deriveResultInsights } from '@shared/result-analysis';
import { calculateScore, type ScorableQuestion } from '@shared/scoring';
import { describe, expect, it } from 'vitest';

const questions: ScorableQuestion[] = [
  {
    id: '1',
    section: 'Reasoning',
    subject: 'Reasoning',
    topic: 'Series',
    difficulty: 'easy',
    positiveMarks: 2,
    negativeMarks: 0.5,
    correctOptionIndex: 1,
    selectedOptionIndex: 1,
    timeSpentSeconds: 20,
  },
  {
    id: '2',
    section: 'Quantitative aptitude',
    subject: 'Mathematics',
    topic: 'Percentages',
    difficulty: 'hard',
    positiveMarks: 2,
    negativeMarks: 0.5,
    correctOptionIndex: 2,
    selectedOptionIndex: 0,
    timeSpentSeconds: 80,
  },
];

describe('Phase 4 evidence analytics', () => {
  it('calculates subject and difficulty evidence without losing negative marks', () => {
    const score = calculateScore(questions, 100);
    expect(score).toMatchObject({
      finalScore: 1.5,
      maxMarks: 4,
      negativeMarks: 0.5,
      accuracy: 50,
    });
    expect(score.subjects.Mathematics).toMatchObject({
      score: -0.5,
      accuracy: 0,
      averageTimeSeconds: 80,
    });
    expect(score.difficulties.easy?.score).toBe(2);
  });

  it('derives strongest, weakest and slow-underperforming sections from evidence', () => {
    const insights = deriveResultInsights(calculateScore(questions, 100));
    expect(insights.strongestSection?.name).toBe('Reasoning');
    expect(insights.weakestSection?.name).toBe('Quantitative aptitude');
    expect(insights.timeManagementIssues[0]).toContain('slower than your average');
    expect(insights.revisionQuestions).toBe(1);
  });

  it('matches verified cutoffs and never promises qualification', () => {
    const comparison = compareCutoff(81, [
      { score: 80, year: 2025 },
      { score: 76, year: 2024 },
    ]);
    expect(comparison).toMatchObject({
      status: 'above',
      previousCutoff: 80,
      difference: 1,
      saferTarget: 90,
    });
    expect(comparison.message).toContain('does not guarantee qualification');
  });

  it('returns insufficient when no exact cutoff dimensions match', () => {
    expect(compareCutoff(81, [])).toMatchObject({
      status: 'insufficient',
      previousCutoff: null,
    });
  });

  it('publishes the readiness formula components and labels sparse history provisional', () => {
    const score = calculateScore(questions, 100);
    const readiness = calculateReadiness([score], compareCutoff(score.finalScore, []));
    expect(readiness.provisional).toBe(true);
    expect(readiness.components.map(({ label }) => label)).toEqual([
      'Recent performance',
      'Accuracy',
      'Coverage',
      'Consistency',
    ]);
    expect(readiness.disclaimer).toContain('not an official prediction');
  });
});
