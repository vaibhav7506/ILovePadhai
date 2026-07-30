import type { PerformanceBreakdown, ScoreSummary } from './scoring';

export const RANK_COHORT_MINIMUM = 20;
export const CUTOFF_SAFETY_BUFFER = 10;

export interface RankedDimension {
  name: string;
  performance: PerformanceBreakdown;
}

export interface ResultInsights {
  strongestSection: RankedDimension | null;
  weakestSection: RankedDimension | null;
  timeManagementIssues: string[];
  revisionQuestions: number;
}

export interface CutoffComparison {
  status: 'above' | 'near' | 'below' | 'insufficient';
  previousCutoff: number | null;
  userScore: number;
  difference: number | null;
  years: number[];
  historicalRange: { minimum: number; maximum: number } | null;
  saferTarget: number | null;
  message: string;
}

export interface ReadinessComponent {
  label: string;
  value: number;
  weight: number;
  evidence: string;
}

const clamp = (value: number) => Math.max(0, Math.min(100, value));
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function dimensionRate(value: PerformanceBreakdown): number {
  return value.maxMarks <= 0 ? 0 : (value.score / value.maxMarks) * 100;
}

export function deriveResultInsights(score: ScoreSummary): ResultInsights {
  const sections = Object.entries(score.sections)
    .map(([name, performance]) => ({ name, performance }))
    .sort((left, right) => dimensionRate(right.performance) - dimensionRate(left.performance));
  const slowThreshold = score.averageTimePerQuestionSeconds * 1.5;
  const slowSections = sections
    .filter(
      ({ performance }) =>
        score.averageTimePerQuestionSeconds > 0 &&
        performance.averageTimeSeconds > slowThreshold &&
        performance.accuracy < score.accuracy,
    )
    .map(({ name }) => `${name} was slower than your average without a matching accuracy gain.`);
  return {
    strongestSection: sections[0] ?? null,
    weakestSection: sections.length > 1 ? (sections.at(-1) ?? null) : (sections[0] ?? null),
    timeManagementIssues: slowSections,
    revisionQuestions: score.incorrect + score.unattempted,
  };
}

export function compareCutoff(
  userScore: number,
  verifiedCutoffs: readonly { score: number; year: number }[],
): CutoffComparison {
  if (verifiedCutoffs.length === 0) {
    return {
      status: 'insufficient',
      previousCutoff: null,
      userScore,
      difference: null,
      years: [],
      historicalRange: null,
      saferTarget: null,
      message: 'No verified historical cutoff matches all selected dimensions.',
    };
  }
  const [newest] = [...verifiedCutoffs].sort((a, b) => b.year - a.year);
  if (!newest) throw new Error('Expected at least one verified cutoff.');
  const difference = round(userScore - newest.score);
  const scores = verifiedCutoffs.map(({ score }) => score);
  const status = difference >= 0 ? 'above' : difference >= -CUTOFF_SAFETY_BUFFER ? 'near' : 'below';
  return {
    status,
    previousCutoff: newest.score,
    userScore,
    difference,
    years: [...new Set(verifiedCutoffs.map(({ year }) => year))].sort((a, b) => b - a),
    historicalRange: { minimum: Math.min(...scores), maximum: Math.max(...scores) },
    saferTarget: round(newest.score + CUTOFF_SAFETY_BUFFER),
    message:
      'Historical comparison only. Being above a previous cutoff does not guarantee qualification.',
  };
}

export function calculateReadiness(
  recentScores: readonly ScoreSummary[],
  cutoff: CutoffComparison,
): { score: number; provisional: boolean; components: ReadinessComponent[]; disclaimer: string } {
  const recent = recentScores.slice(0, 5);
  if (recent.length === 0)
    return {
      score: 0,
      provisional: true,
      components: [],
      disclaimer: 'Readiness is not an official prediction.',
    };
  const [latest] = recent;
  if (!latest) throw new Error('Expected at least one recent score.');
  const scoreRates = recent.map((item) =>
    item.maxMarks <= 0 ? 0 : clamp((item.finalScore / item.maxMarks) * 100),
  );
  const mean = scoreRates.reduce((sum, value) => sum + value, 0) / scoreRates.length;
  const deviation = Math.sqrt(
    scoreRates.reduce((sum, value) => sum + (value - mean) ** 2, 0) / scoreRates.length,
  );
  const components: ReadinessComponent[] = [
    {
      label: 'Recent performance',
      value: round(mean),
      weight: 35,
      evidence: `Average score rate across ${String(recent.length)} comparable attempt${recent.length === 1 ? '' : 's'}.`,
    },
    {
      label: 'Accuracy',
      value: round(recent.reduce((sum, item) => sum + item.accuracy, 0) / recent.length),
      weight: 25,
      evidence: 'Average attempted-question accuracy.',
    },
    {
      label: 'Coverage',
      value: round(((latest.correct + latest.incorrect) / Math.max(1, latest.total)) * 100),
      weight: 15,
      evidence: 'Share of the latest paper attempted.',
    },
    {
      label: 'Consistency',
      value: round(clamp(100 - deviation * 4)),
      weight: 15,
      evidence: 'Variation in score rate across recent comparable attempts.',
    },
  ];
  if (cutoff.difference !== null) {
    components.push({
      label: 'Cutoff margin',
      value: round(clamp(50 + (cutoff.difference / CUTOFF_SAFETY_BUFFER) * 50)),
      weight: 10,
      evidence: 'Margin against the latest exactly matched verified historical cutoff.',
    });
  }
  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  return {
    score: Math.round(
      components.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight,
    ),
    provisional: recent.length < 3,
    components,
    disclaimer: 'Readiness is a transparent study indicator, not an official prediction.',
  };
}
