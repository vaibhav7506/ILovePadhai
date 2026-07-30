import { z } from 'zod';

export const deviceCategorySchema = z.enum(['mobile', 'tablet', 'desktop', 'unknown']);
export const referrerCategorySchema = z.enum([
  'direct',
  'search',
  'social',
  'referral',
  'internal',
  'unknown',
]);
export const eventTypeSchema = z.enum([
  'page_view',
  'exam_selection',
  'quiz_start',
  'quiz_completion',
  'page_exit',
]);

export const visitorRegistrationSchema = z.object({
  visitorUuid: z.uuid(),
  sessionUuid: z.uuid(),
  landingPath: z.string().startsWith('/').max(256),
  deviceCategory: deviceCategorySchema,
  referrerCategory: referrerCategorySchema,
  turnstileToken: z.string().max(2048).optional(),
});

export const pageEventSchema = z.object({
  eventUuid: z.uuid(),
  visitorUuid: z.uuid(),
  sessionUuid: z.uuid(),
  eventType: eventTypeSchema,
  path: z.string().startsWith('/').max(256),
  examinationSlug: z.string().max(80).optional(),
});

export const consentSchema = z.object({
  visitorUuid: z.uuid(),
  anonymousAnalytics: z.boolean(),
});

export type VisitorRegistration = z.infer<typeof visitorRegistrationSchema>;
export type PageEventInput = z.infer<typeof pageEventSchema>;
export type DeviceCategory = z.infer<typeof deviceCategorySchema>;
export type ReferrerCategory = z.infer<typeof referrerCategorySchema>;
