import { zValidator } from '@hono/zod-validator';
import {
  offlineNoteParamsSchema,
  offlinePracticeParamsSchema,
  type OfflineCatalogueItem,
  type OfflinePracticeQuestion,
} from '@shared/offline';
import { Hono } from 'hono';

interface OfflineEnvironment {
  Bindings: Env;
}

interface PracticeRow {
  id: string;
  examinationSlug: string;
  examination: string;
  subject: string;
  topic: string;
  questionText: string;
  explanationMarkdown: string | null;
  language: 'en' | 'hi' | 'bilingual';
  correctOptionIndex: number;
  sourceUrl: string;
  sourcePage: number;
  publishedAt: string;
}

const routes = new Hono<OfflineEnvironment>();
const cacheHeaders = {
  'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
  'X-ExamForge-Offline-Safe': 'true',
};

routes.get('/api/offline/catalogue', async (context) => {
  const [notes, practices] = await Promise.all([
    context.env.DB.prepare(
      `SELECT n.id, n.title, n.subject, n.topic, n.language,
              n.last_updated_at AS version
         FROM notes n
        WHERE n.verification_status = 'published'
          AND EXISTS (SELECT 1 FROM note_citations c WHERE c.note_id = n.id)
        ORDER BY n.published_at DESC LIMIT 30`,
    ).all<{
      id: string;
      title: string;
      subject: string;
      topic: string;
      language: 'en' | 'hi' | 'bilingual';
      version: string;
    }>(),
    context.env.DB.prepare(
      `SELECT e.slug AS examinationSlug, e.short_name AS examination,
              q.subject, q.language, MAX(q.published_at) AS version,
              COUNT(*) AS questionCount
         FROM questions q JOIN examinations e ON e.id = q.examination_id
         JOIN answer_key_versions k ON k.question_id = q.id AND k.is_current = 1
        WHERE q.verification_status = 'published'
          AND ((q.content_origin = 'official_pyq' AND k.key_type = 'final')
            OR (q.content_origin <> 'official_pyq' AND k.key_type = 'editorial'))
        GROUP BY e.slug, e.short_name, q.subject, q.language
        HAVING COUNT(*) >= 5
        ORDER BY e.priority, q.subject LIMIT 30`,
    ).all<{
      examinationSlug: string;
      examination: string;
      subject: string;
      language: 'en' | 'hi' | 'bilingual';
      version: string;
      questionCount: number;
    }>(),
  ]);

  const items: OfflineCatalogueItem[] = [
    ...notes.results.map((note) => ({
      id: note.id,
      kind: 'note' as const,
      title: note.title,
      detail: `${note.subject} · ${note.topic}`,
      language: note.language,
      downloadUrl: `/api/offline/notes/${encodeURIComponent(note.id)}`,
      version: note.version,
    })),
    ...practices.results.map((practice) => ({
      id: `${practice.examinationSlug}:${practice.subject}`,
      kind: 'practice' as const,
      title: `${practice.examination} · ${practice.subject}`,
      detail: `${String(Math.min(practice.questionCount, 20))} verified questions · offline self-assessment`,
      language: practice.language,
      downloadUrl: `/api/offline/practice/${encodeURIComponent(practice.examinationSlug)}/${encodeURIComponent(practice.subject)}`,
      version: practice.version,
    })),
  ];
  return context.json({ items, generatedAt: new Date().toISOString() }, 200, cacheHeaders);
});

routes.get(
  '/api/offline/notes/:id',
  zValidator('param', offlineNoteParamsSchema),
  async (context) => {
    const { id } = context.req.valid('param');
    const note = await context.env.DB.prepare(
      `SELECT n.id, n.title, n.subject, n.topic, n.summary_markdown AS summaryMarkdown,
              n.language, n.last_updated_at AS version
         FROM notes n
        WHERE n.id = ? AND n.verification_status = 'published'
          AND EXISTS (SELECT 1 FROM note_citations c WHERE c.note_id = n.id)`,
    )
      .bind(id)
      .first();
    if (!note) return context.json({ error: 'Verified note not found.' }, 404);
    const citations = await context.env.DB.prepare(
      `SELECT c.label, c.source_page AS sourcePage, s.source_url AS sourceUrl
         FROM note_citations c JOIN official_sources s ON s.id = c.source_id
        WHERE c.note_id = ? ORDER BY c.label LIMIT 20`,
    )
      .bind(id)
      .all();
    return context.json(
      {
        kind: 'note',
        competitiveEligible: false,
        note,
        citations: citations.results,
      },
      200,
      cacheHeaders,
    );
  },
);

routes.get(
  '/api/offline/practice/:examinationSlug/:subject',
  zValidator('param', offlinePracticeParamsSchema),
  async (context) => {
    const { examinationSlug, subject } = context.req.valid('param');
    const { results } = await context.env.DB.prepare(
      `SELECT q.id, e.slug AS examinationSlug, e.short_name AS examination,
              q.subject, q.topic, q.question_text AS questionText,
              q.explanation_markdown AS explanationMarkdown, q.language,
              k.correct_option_index AS correctOptionIndex,
              s.source_url AS sourceUrl, q.source_page AS sourcePage,
              q.published_at AS publishedAt
         FROM questions q
         JOIN examinations e ON e.id = q.examination_id
         JOIN source_documents d ON d.id = q.document_id
         JOIN official_sources s ON s.id = d.source_id
         JOIN answer_key_versions k ON k.question_id = q.id AND k.is_current = 1
        WHERE e.slug = ? AND q.subject = ? AND q.verification_status = 'published'
          AND ((q.content_origin = 'official_pyq' AND k.key_type = 'final')
            OR (q.content_origin <> 'official_pyq' AND k.key_type = 'editorial'))
        ORDER BY q.year DESC, q.id LIMIT 20`,
    )
      .bind(examinationSlug, subject)
      .all<PracticeRow>();
    if (results.length < 5)
      return context.json({ error: 'A verified offline set is not available.' }, 404);
    const questions: OfflinePracticeQuestion[] = await Promise.all(
      results.map(async (question) => {
        const options = await context.env.DB.prepare(
          `SELECT option_index AS optionIndex, option_text AS optionText
             FROM question_options WHERE question_id = ? ORDER BY option_index`,
        )
          .bind(question.id)
          .all<{ optionIndex: number; optionText: string }>();
        return { ...question, options: options.results };
      }),
    );
    return context.json(
      {
        kind: 'practice',
        title: `${results[0]?.examination ?? examinationSlug} · ${subject}`,
        version: results[0]?.publishedAt,
        competitiveEligible: false,
        integrityLabel: 'Offline self-assessment — excluded from ranks and readiness',
        questions,
      },
      200,
      cacheHeaders,
    );
  },
);

export { routes as offlineRoutes };
