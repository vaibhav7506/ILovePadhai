import { z } from 'zod';

export const attemptModes = ['standard', 'custom', 'previous_year', 'diagnostic'] as const;

const customSelectionSchema = z.object({
  subject: z.string().min(1).max(120).optional(),
  topic: z.string().min(1).max(120).optional(),
  difficulty: z.enum(['easy', 'moderate', 'hard', 'unrated']).optional(),
  yearFrom: z.number().int().min(1950).max(2200).optional(),
  yearTo: z.number().int().min(1950).max(2200).optional(),
  origins: z
    .array(z.enum(['official_pyq', 'editorial', 'ai_generated_practice']))
    .min(1)
    .default(['official_pyq']),
  questionCount: z.number().int().min(1).max(100),
  durationMinutes: z.number().int().min(1).max(240),
  weakQuestionsOnly: z.boolean().default(false),
});

const previousYearSelectionSchema = z.object({
  year: z.number().int().min(1950).max(2200),
  examDate: z.iso.date().optional(),
  shift: z.string().min(1).max(80).optional(),
});

export const createAttemptSchema = z
  .object({
    visitorUuid: z.uuid(),
    examinationSlug: z.string().min(3).max(80),
    tierStage: z.string().min(1).max(80),
    mode: z.enum(attemptModes),
    nickname: z.string().trim().min(2).max(32).optional(),
    category: z.string().min(1).max(80).optional(),
    region: z.string().min(1).max(160).optional(),
    post: z.string().min(1).max(160).optional(),
    stage: z.string().min(1).max(80).optional(),
    custom: customSelectionSchema.optional(),
    previousYear: previousYearSelectionSchema.optional(),
  })
  .superRefine((input, context) => {
    if (input.mode === 'custom' && !input.custom) {
      context.addIssue({
        code: 'custom',
        path: ['custom'],
        message: 'Custom settings are required.',
      });
    }
    if (input.mode === 'previous_year' && !input.previousYear) {
      context.addIssue({
        code: 'custom',
        path: ['previousYear'],
        message: 'Previous-year paper settings are required.',
      });
    }
    if (
      input.custom?.yearFrom &&
      input.custom.yearTo &&
      input.custom.yearFrom > input.custom.yearTo
    ) {
      context.addIssue({
        code: 'custom',
        path: ['custom', 'yearFrom'],
        message: 'The starting year cannot be after the ending year.',
      });
    }
  });

export const syncResponseSchema = z.object({
  selectedOptionIndex: z.number().int().min(0).max(3).nullable(),
  markedForReview: z.boolean(),
  clientElapsedSeconds: z
    .number()
    .int()
    .nonnegative()
    .max(24 * 60 * 60),
  questionElapsedSeconds: z
    .number()
    .int()
    .nonnegative()
    .max(24 * 60 * 60)
    .default(0),
  clientRevision: z.number().int().positive().max(1_000_000),
  mutationId: z.uuid(),
});

export const leaderboardProfileSchema = z.object({
  nickname: z.string().trim().min(2).max(24),
  visible: z.boolean(),
});

export const attemptTokenPayloadSchema = z.object({
  attemptId: z.uuid(),
  visitorNumber: z.number().int().positive(),
  issuedAt: z.number().int().positive(),
  nonce: z.string().min(16).max(120),
});

export type AttemptMode = (typeof attemptModes)[number];
export type AttemptTokenPayload = z.infer<typeof attemptTokenPayloadSchema>;
export type CreateAttemptInput = z.infer<typeof createAttemptSchema>;
