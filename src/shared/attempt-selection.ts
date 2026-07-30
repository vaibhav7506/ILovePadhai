import type { CreateAttemptInput } from './attempt';

export interface CandidateQuestion {
  id: string;
  document_id: string;
  section: string;
  subject: string;
  topic: string;
  difficulty: string;
  year: number;
  exam_date: string | null;
  shift: string | null;
  content_origin: string;
  positive_marks: number;
  negative_marks: number;
}

export interface PatternConfiguration {
  id: string;
  sections_json: string;
  subjects_json: string;
  total_questions: number;
  standard_duration_minutes: number;
}

interface PatternSection {
  name: string;
  questionCount: number;
}

function parseArray<T>(value: string, validator: (item: unknown) => item is T): T[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every(validator)) throw new Error('Invalid pattern data.');
  return parsed;
}

function isPatternSection(value: unknown): value is PatternSection {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'name') === 'string' &&
    typeof Reflect.get(value, 'questionCount') === 'number'
  );
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function selectStandard(
  candidates: readonly CandidateQuestion[],
  pattern: PatternConfiguration,
): CandidateQuestion[] {
  const sections = parseArray(pattern.sections_json, isPatternSection);
  const selected: CandidateQuestion[] = [];
  for (const section of sections) {
    const available = candidates.filter((question) => question.section === section.name);
    if (available.length < section.questionCount) return [];
    selected.push(...available.slice(0, section.questionCount));
  }
  return selected;
}

function selectDiagnostic(
  candidates: readonly CandidateQuestion[],
  pattern: PatternConfiguration,
): CandidateQuestion[] {
  const subjects = parseArray(pattern.subjects_json, isString);
  const bySubject = new Map(
    subjects.map((subject) => [
      subject,
      candidates.filter((question) => question.subject === subject),
    ]),
  );
  const selected: CandidateQuestion[] = [];
  let index = 0;
  while (selected.length < Math.min(pattern.total_questions, 30)) {
    let added = false;
    for (const subject of subjects) {
      const question = bySubject.get(subject)?.[index];
      if (question) {
        selected.push(question);
        added = true;
      }
    }
    if (!added) break;
    index += 1;
  }
  return selected;
}

export function selectQuestions(
  candidates: readonly CandidateQuestion[],
  pattern: PatternConfiguration | null,
  input: CreateAttemptInput,
): { questions: CandidateQuestion[]; durationSeconds: number } {
  if (input.mode === 'standard') {
    if (!pattern) return { questions: [], durationSeconds: 0 };
    return {
      questions: selectStandard(candidates, pattern),
      durationSeconds: pattern.standard_duration_minutes * 60,
    };
  }
  if (input.mode === 'custom' && input.custom) {
    const custom = input.custom;
    const filtered = candidates.filter(
      (question) =>
        (!custom.subject || question.subject === custom.subject) &&
        (!custom.topic || question.topic === custom.topic) &&
        (!custom.difficulty || question.difficulty === custom.difficulty) &&
        (!custom.yearFrom || question.year >= custom.yearFrom) &&
        (!custom.yearTo || question.year <= custom.yearTo) &&
        custom.origins.includes(question.content_origin as (typeof custom.origins)[number]),
    );
    return {
      questions: filtered.slice(0, custom.questionCount),
      durationSeconds: custom.durationMinutes * 60,
    };
  }
  if (input.mode === 'previous_year' && input.previousYear) {
    const previousYear = input.previousYear;
    const matching = candidates.filter(
      (question) =>
        question.content_origin === 'official_pyq' &&
        question.year === previousYear.year &&
        (!previousYear.examDate || question.exam_date === previousYear.examDate) &&
        (!previousYear.shift || question.shift === previousYear.shift),
    );
    const documentId = matching[0]?.document_id;
    const paper = documentId
      ? matching.filter((question) => question.document_id === documentId)
      : [];
    return {
      questions: paper,
      durationSeconds: (pattern?.standard_duration_minutes ?? Math.max(1, paper.length)) * 60,
    };
  }
  if (input.mode === 'diagnostic' && pattern) {
    return {
      questions: selectDiagnostic(candidates, pattern),
      durationSeconds: Math.min(pattern.standard_duration_minutes, 45) * 60,
    };
  }
  return { questions: [], durationSeconds: 0 };
}
