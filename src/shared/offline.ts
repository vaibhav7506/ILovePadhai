import { z } from 'zod';

export const offlineNoteParamsSchema = z.object({
  id: z.uuid(),
});

export const offlinePracticeParamsSchema = z.object({
  examinationSlug: z.string().regex(/^[a-z0-9-]{2,80}$/),
  subject: z.string().min(1).max(80),
});

export interface OfflineCatalogueItem {
  id: string;
  kind: 'note' | 'practice';
  title: string;
  detail: string;
  language: 'en' | 'hi' | 'bilingual';
  downloadUrl: string;
  version: string;
}

export interface OfflineOption {
  optionIndex: number;
  optionText: string;
}

export interface OfflinePracticeQuestion {
  id: string;
  questionText: string;
  subject: string;
  topic: string;
  language: 'en' | 'hi' | 'bilingual';
  options: OfflineOption[];
  correctOptionIndex: number;
  explanationMarkdown: string | null;
  sourceUrl: string;
  sourcePage: number;
}
