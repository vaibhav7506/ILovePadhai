import {
  buildDailyPlan,
  nextRevision,
  planItemUpdateSchema,
  studyCompletionPercent,
  type MasteryEvidence,
} from '@shared/study';
import { describe, expect, it } from 'vitest';

const evidence: MasteryEvidence[] = [
  {
    subject: 'Mathematics',
    topic: 'Percentages',
    questionsSeen: 10,
    correctCount: 3,
    incorrectCount: 6,
    skippedCount: 1,
    totalTimeSeconds: 700,
    masteryScore: 30,
    lastPractisedAt: '2026-07-28T00:00:00.000Z',
  },
  {
    subject: 'Reasoning',
    topic: 'Analogy',
    questionsSeen: 10,
    correctCount: 9,
    incorrectCount: 1,
    skippedCount: 0,
    totalTimeSeconds: 300,
    masteryScore: 90,
    lastPractisedAt: '2026-07-29T00:00:00.000Z',
  },
];

describe('Phase 5 adaptive preparation', () => {
  it('resets an incorrect revision to one day', () => {
    expect(nextRevision(15, false, 5)).toEqual({ intervalDays: 1, status: 'scheduled' });
  });

  it('advances confident correct revision across wider intervals', () => {
    expect(nextRevision(3, true, 5)).toEqual({ intervalDays: 15, status: 'scheduled' });
  });

  it('marks high-confidence long-interval recall as mastered', () => {
    expect(nextRevision(30, true, 4)).toEqual({ intervalDays: 90, status: 'mastered' });
  });

  it('allocates revision and prioritises the weakest measured topic', () => {
    const plan = buildDailyPlan(60, evidence, 4);
    expect(plan[0]).toMatchObject({ itemType: 'revision', minutes: 15 });
    expect(plan[1]).toMatchObject({
      itemType: 'adaptive_practice',
      subject: 'Mathematics',
      topic: 'Percentages',
    });
    expect(plan[1]?.rationale).toContain('lowest measured mastery area at 30%');
  });

  it('uses an honest diagnostic baseline when no mastery evidence exists', () => {
    expect(buildDailyPlan(45, [], 0)).toEqual([
      {
        itemType: 'mock',
        subject: null,
        topic: null,
        minutes: 45,
        rationale:
          'Complete a diagnostic test to replace this baseline session with measured topics.',
      },
    ]);
  });
});

describe('comprehension-gated study progress', () => {
  it('rejects direct completion updates', () => {
    expect(
      planItemUpdateSchema.safeParse({
        visitorUuid: '77a0fb6a-44d5-41ea-8d30-e9748995c9f9',
        status: 'completed',
      }).success,
    ).toBe(false);
  });

  it('excludes skipped tasks from completion percentage', () => {
    expect(studyCompletionPercent(2, 1, 1)).toBe(50);
  });
});
