/** Inputs accepted by the server-only scoring workflow. */
export interface ScorableQuestion {
  id: string;
  section: string;
  subject?: string;
  topic: string;
  difficulty?: string;
  positiveMarks: number;
  negativeMarks: number;
  correctOptionIndex: number;
  selectedOptionIndex: number | null;
  timeSpentSeconds: number;
}

export interface PerformanceBreakdown {
  correct: number;
  incorrect: number;
  unattempted: number;
  score: number;
  total: number;
  maxMarks: number;
  accuracy: number;
  averageTimeSeconds: number;
}

export interface ScoreSummary extends PerformanceBreakdown {
  rawScore: number;
  negativeMarks: number;
  finalScore: number;
  accuracy: number;
  completionTimeSeconds: number;
  averageTimePerQuestionSeconds: number;
  maxMarks: number;
  sections: Record<string, PerformanceBreakdown>;
  subjects: Record<string, PerformanceBreakdown>;
  topics: Record<string, PerformanceBreakdown>;
  difficulties: Record<string, PerformanceBreakdown>;
}

function emptyBreakdown(): PerformanceBreakdown {
  return {
    correct: 0,
    incorrect: 0,
    unattempted: 0,
    score: 0,
    total: 0,
    maxMarks: 0,
    accuracy: 0,
    averageTimeSeconds: 0,
  };
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateScore(
  questions: readonly ScorableQuestion[],
  completionTimeSeconds: number,
): ScoreSummary {
  const summary: ScoreSummary = {
    ...emptyBreakdown(),
    rawScore: 0,
    negativeMarks: 0,
    finalScore: 0,
    accuracy: 0,
    completionTimeSeconds,
    averageTimePerQuestionSeconds:
      questions.length === 0 ? 0 : round(completionTimeSeconds / questions.length),
    maxMarks: 0,
    sections: {},
    subjects: {},
    topics: {},
    difficulties: {},
  };

  for (const question of questions) {
    const section = (summary.sections[question.section] ??= emptyBreakdown());
    const subject = (summary.subjects[question.subject ?? 'General'] ??= emptyBreakdown());
    const topic = (summary.topics[question.topic] ??= emptyBreakdown());
    const difficulty = (summary.difficulties[question.difficulty ?? 'unrated'] ??=
      emptyBreakdown());
    for (const breakdown of [summary, section, subject, topic, difficulty]) {
      breakdown.total += 1;
      breakdown.maxMarks += question.positiveMarks;
      breakdown.averageTimeSeconds += question.timeSpentSeconds;
    }

    if (question.selectedOptionIndex === null) {
      for (const breakdown of [summary, section, subject, topic, difficulty])
        breakdown.unattempted += 1;
      continue;
    }
    if (question.selectedOptionIndex === question.correctOptionIndex) {
      for (const breakdown of [summary, section, subject, topic, difficulty])
        breakdown.correct += 1;
      summary.rawScore += question.positiveMarks;
      for (const breakdown of [section, subject, topic, difficulty])
        breakdown.score += question.positiveMarks;
    } else {
      for (const breakdown of [summary, section, subject, topic, difficulty])
        breakdown.incorrect += 1;
      summary.negativeMarks += question.negativeMarks;
      for (const breakdown of [section, subject, topic, difficulty])
        breakdown.score -= question.negativeMarks;
    }
  }

  summary.rawScore = round(summary.rawScore);
  summary.negativeMarks = round(summary.negativeMarks);
  summary.finalScore = round(summary.rawScore - summary.negativeMarks);
  summary.score = summary.finalScore;
  const attempted = summary.correct + summary.incorrect;
  summary.accuracy = attempted === 0 ? 0 : round((summary.correct / attempted) * 100);
  for (const breakdown of [
    summary,
    ...Object.values(summary.sections),
    ...Object.values(summary.subjects),
    ...Object.values(summary.topics),
    ...Object.values(summary.difficulties),
  ]) {
    breakdown.score = round(breakdown.score);
    breakdown.maxMarks = round(breakdown.maxMarks);
    const breakdownAttempted = breakdown.correct + breakdown.incorrect;
    breakdown.accuracy =
      breakdownAttempted === 0 ? 0 : round((breakdown.correct / breakdownAttempted) * 100);
    breakdown.averageTimeSeconds =
      breakdown.total === 0 ? 0 : round(breakdown.averageTimeSeconds / breakdown.total);
  }
  return summary;
}
