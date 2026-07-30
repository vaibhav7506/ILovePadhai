import { z } from 'zod';

export const studyProfileSchema = z.object({
  visitorUuid: z.uuid(),
  targetExaminationSlug: z.string().min(3).max(80).nullable(),
  expectedExamDate: z.iso.date().nullable(),
  dailyMinutes: z.number().int().min(15).max(720),
  paused: z.boolean(),
});

export const mistakeReasons = [
  'concept_not_understood',
  'formula_forgotten',
  'calculation_mistake',
  'guessed',
  'read_incorrectly',
  'time_pressure',
] as const;

export const mistakeUpdateSchema = z.object({
  visitorUuid: z.uuid(),
  mistakeReason: z.enum(mistakeReasons).nullable().optional(),
  bookmarked: z.boolean().optional(),
});

export const revisionReviewSchema = z.object({
  visitorUuid: z.uuid(),
  correct: z.boolean(),
  confidence: z.number().int().min(1).max(5),
});

export const planItemUpdateSchema = z.object({
  visitorUuid: z.uuid(),
  status: z.enum(['planned', 'skipped']),
});

export const lessonEngagementSchema = z.object({
  visitorUuid: z.uuid(),
  engagedSeconds: z.number().int().min(0).max(24 * 60 * 60),
  scrollPercent: z.number().int().min(0).max(100),
  visibleSeconds: z.number().int().min(0).max(24 * 60 * 60),
  sectionsOpened: z.number().int().min(0).max(100),
  examplesInteracted: z.number().int().min(0).max(100),
});

export const comprehensionSubmitSchema = z.object({
  visitorUuid: z.uuid(),
  checkId: z.uuid(),
  answers: z.array(z.object({
    questionId: z.string().min(1).max(120),
    selectedOptionIndex: z.number().int().min(0).max(3).nullable(),
  })).min(2).max(5),
});

export function studyCompletionPercent(completed: number, retryRequired: number, planned: number): number {
  const eligible = completed + retryRequired + planned;
  return eligible === 0 ? 0 : Math.round((completed / eligible) * 100);
}

export const doubtRequestSchema = z.object({
  visitorUuid: z.uuid(),
  questionId: z.string().min(1).max(120),
  question: z.string().trim().min(3).max(800),
  turnstileToken: z.string().max(4096).optional(),
});

export interface MasteryEvidence {
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

export interface PlanRecommendation {
  itemType: 'adaptive_practice' | 'revision' | 'mock' | 'notes';
  subject: string | null;
  topic: string | null;
  minutes: number;
  rationale: string;
}

const intervals = [1, 3, 7, 15, 30, 60, 90] as const;

export function nextRevision(
  currentIntervalDays: number,
  correct: boolean,
  confidence: number,
): { intervalDays: number; status: 'scheduled' | 'mastered' } {
  if (!correct) return { intervalDays: 1, status: 'scheduled' };
  const currentIndex = Math.max(
    0,
    intervals.findIndex((interval) => interval >= currentIntervalDays),
  );
  const advance = confidence >= 4 ? 2 : 1;
  const intervalDays = intervals[Math.min(intervals.length - 1, currentIndex + advance)] ?? 90;
  return {
    intervalDays,
    status: intervalDays >= 60 && confidence >= 4 ? 'mastered' : 'scheduled',
  };
}

export function buildDailyPlan(
  dailyMinutes: number,
  mastery: readonly MasteryEvidence[],
  dueRevisionCount: number,
): PlanRecommendation[] {
  const minutes = Math.max(15, Math.min(720, dailyMinutes));
  const weak = [...mastery].sort(
    (a, b) => a.masteryScore - b.masteryScore || a.lastPractisedAt.localeCompare(b.lastPractisedAt),
  );
  const plan: PlanRecommendation[] = [];
  const revisionMinutes = dueRevisionCount > 0 ? Math.max(10, Math.round(minutes * 0.25)) : 0;
  if (revisionMinutes > 0) {
    plan.push({
      itemType: 'revision',
      subject: null,
      topic: null,
      minutes: revisionMinutes,
      rationale: `${String(dueRevisionCount)} spaced-revision question${dueRevisionCount === 1 ? ' is' : 's are'} due from your own mistake history.`,
    });
  }
  const practiceBudget = minutes - revisionMinutes;
  if (weak.length > 0) {
    const first = weak[0];
    if (first) {
      plan.push({
        itemType: 'adaptive_practice',
        subject: first.subject,
        topic: first.topic,
        minutes: Math.max(10, Math.round(practiceBudget * 0.65)),
        rationale: `${first.topic} is your lowest measured mastery area at ${String(first.masteryScore)}%.`,
      });
    }
    const strong = [...weak].sort((a, b) => b.masteryScore - a.masteryScore)[0];
    if (strong && strong.topic !== first?.topic) {
      plan.push({
        itemType: 'adaptive_practice',
        subject: strong.subject,
        topic: strong.topic,
        minutes: Math.max(5, practiceBudget - (plan.at(-1)?.minutes ?? 0)),
        rationale: `${strong.topic} is included for periodic retention, not because it is weak.`,
      });
    }
  } else {
    plan.push({
      itemType: 'mock',
      subject: null,
      topic: null,
      minutes: practiceBudget,
      rationale:
        'Complete a diagnostic test to replace this baseline session with measured topics.',
    });
  }
  return plan.filter((item) => item.minutes >= 5);
}
