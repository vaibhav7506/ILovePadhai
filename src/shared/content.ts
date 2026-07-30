import { z } from 'zod';

export const contentTypes = [
  'question_paper',
  'tentative_answer_key',
  'final_answer_key',
  'syllabus',
  'examination_pattern',
  'cutoff',
  'notice',
  'licensed_note_source',
] as const;

export const contentOrigins = ['official_pyq', 'editorial', 'ai_generated_practice'] as const;

export const verificationStatuses = [
  'imported',
  'needs_review',
  'tentative_key',
  'verified_official',
  'verified_editorial',
  'disputed',
  'rejected',
  'published',
  'archived',
] as const;

export const officialSourceSchema = z.object({
  authorityId: z.string().min(3).max(80),
  examinationSlug: z.string().min(3).max(80).optional(),
  contentType: z.enum(contentTypes),
  sourceUrl: z.url().max(2048),
  retrievalSchedule: z.string().max(120).optional(),
  copyrightStatus: z.enum([
    'official_publication',
    'reproduction_permitted',
    'metadata_only',
    'restricted',
  ]),
  attributionRequirements: z.string().max(500).optional(),
  enabled: z.boolean().default(true),
});

export const sourceDocumentSchema = z.object({
  sourceId: z.uuid(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  fileName: z.string().min(1).max(180),
  mimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024),
  pageCount: z.number().int().positive().max(2000),
  reproductionStatus: z.enum(['stored_permitted', 'metadata_only', 'restricted']),
  retrievedAt: z.iso.datetime(),
  r2Key: z.string().min(1).max(500).optional(),
});

export const structuredQuestionSchema = z.object({
  examinationSlug: z.string().min(3).max(80),
  qualificationLevel: z.enum(['secondary', 'graduate']),
  tierStage: z.string().min(1).max(80),
  year: z.number().int().min(1950).max(2200),
  examDate: z.iso.date().optional(),
  shift: z.string().max(80).optional(),
  section: z.string().min(1).max(120),
  subject: z.string().min(1).max(120),
  topic: z.string().min(1).max(120),
  subtopic: z.string().max(120).optional(),
  difficulty: z.enum(['easy', 'moderate', 'hard', 'unrated']),
  questionText: z.string().min(5).max(10_000),
  explanationMarkdown: z.string().min(10).max(20_000).optional(),
  options: z.tuple([
    z.string().min(1).max(3000),
    z.string().min(1).max(3000),
    z.string().min(1).max(3000),
    z.string().min(1).max(3000),
  ]),
  positiveMarks: z.number().min(0).max(100),
  negativeMarks: z.number().min(0).max(100),
  sourcePage: z.number().int().positive().max(2000),
  officialQuestionId: z.string().max(120).optional(),
  language: z.enum(['en', 'hi', 'bilingual']),
  contentOrigin: z.enum(contentOrigins),
});

export const structuredImportSchema = z.object({
  documentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  parserVersion: z.string().min(1).max(80),
  ocrUsed: z.boolean(),
  questions: z.array(structuredQuestionSchema).min(1).max(20),
});

export const answerKeyVersionSchema = z.object({
  sourceId: z.uuid(),
  keyType: z.enum(['tentative', 'final', 'editorial']),
  versionLabel: z.string().min(1).max(120),
  correctOptionIndex: z.number().int().min(0).max(3),
  effectiveAt: z.iso.datetime(),
});

export const reviewTransitionSchema = z.object({
  toStatus: z.enum(verificationStatuses),
  reason: z.string().min(3).max(1000),
});

const patternSectionSchema = z.object({
  name: z.string().min(1).max(120),
  subjects: z.array(z.string().min(1).max(120)).min(1),
  questionCount: z.number().int().positive(),
  marksPerQuestion: z.number().nonnegative(),
});

export const examinationPatternSchema = z
  .object({
    examinationSlug: z.string().min(3).max(80),
    tierStage: z.string().min(1).max(80),
    version: z.string().min(1).max(80),
    subjects: z.array(z.string().min(1).max(120)).min(1),
    sections: z.array(patternSectionSchema).min(1),
    totalQuestions: z.number().int().positive(),
    totalMarks: z.number().positive(),
    marksPerQuestion: z.number().nonnegative(),
    negativeMarking: z.number().nonnegative(),
    standardDurationMinutes: z.number().int().positive(),
    sectionalDuration: z.record(z.string(), z.number().int().positive()).optional(),
    languageRules: z.record(z.string(), z.unknown()),
    navigationRules: z.record(z.string(), z.unknown()),
    qualificationStages: z.array(z.string().min(1).max(120)).min(1),
    officialSourceId: z.uuid(),
    effectiveFrom: z.iso.date(),
    verificationStatus: z.enum(['needs_review', 'verified_official']),
  })
  .superRefine((pattern, context) => {
    const sectionQuestions = pattern.sections.reduce(
      (total, section) => total + section.questionCount,
      0,
    );
    if (sectionQuestions !== pattern.totalQuestions) {
      context.addIssue({
        code: 'custom',
        path: ['sections'],
        message: 'Section question counts must equal totalQuestions.',
      });
    }
  });

export const cutoffSchema = z.object({
  examinationSlug: z.string().min(3).max(80),
  year: z.number().int().min(1950).max(2200),
  tierStage: z.string().min(1).max(80),
  category: z.string().min(1).max(80),
  gender: z.string().max(80).optional(),
  post: z.string().max(160).optional(),
  region: z.string().max(160).optional(),
  scoreType: z.enum(['raw', 'normalised']),
  cutoffMarks: z.number(),
  vacancyCount: z.number().int().nonnegative().optional(),
  officialSourceId: z.uuid(),
  verificationStatus: z.enum(['needs_review', 'verified_official']),
});

export const noteSchema = z.object({
  examinationSlug: z.string().min(3).max(80),
  subject: z.string().min(1).max(120),
  topic: z.string().min(1).max(120),
  title: z.string().min(3).max(180),
  summaryMarkdown: z.string().min(20).max(50_000),
  language: z.enum(['en', 'hi', 'bilingual']),
  citations: z
    .array(
      z.object({
        sourceId: z.uuid(),
        label: z.string().min(1).max(240),
        sourcePage: z.number().int().positive().optional(),
      }),
    )
    .min(1)
    .max(30),
  relatedTopics: z.array(z.string().min(1).max(120)).max(30).default([]),
  relatedQuestionIds: z.array(z.uuid()).max(100).default([]),
});

export const questionReportSchema = z.object({
  visitorUuid: z.uuid(),
  reason: z.enum([
    'answer_may_be_incorrect',
    'question_text_issue',
    'source_mismatch',
    'translation_issue',
    'other',
  ]),
  detail: z.string().max(1000).optional(),
});

const transitionMap: Readonly<Record<string, readonly string[]>> = {
  imported: ['needs_review', 'rejected'],
  needs_review: [
    'tentative_key',
    'verified_official',
    'verified_editorial',
    'disputed',
    'rejected',
  ],
  tentative_key: ['verified_official', 'disputed', 'rejected'],
  verified_official: ['published', 'disputed', 'archived'],
  verified_editorial: ['published', 'rejected', 'archived'],
  disputed: ['needs_review', 'rejected', 'archived'],
  published: ['disputed', 'archived'],
  rejected: ['needs_review', 'archived'],
  archived: ['needs_review'],
};

export function isAllowedQuestionTransition(from: string, to: string): boolean {
  return transitionMap[from]?.includes(to) ?? false;
}

export function hostnameMatchesAuthority(
  sourceUrl: string,
  authorityDomains: readonly string[],
): boolean {
  let hostname: string;
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol !== 'https:') return false;
    hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return false;
  }
  return authorityDomains.some((domain) => {
    const normalized = domain.toLowerCase().replace(/\.$/, '');
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  });
}

export type StructuredImport = z.infer<typeof structuredImportSchema>;
export type StructuredQuestion = z.infer<typeof structuredQuestionSchema>;
