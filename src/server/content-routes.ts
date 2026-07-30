import { zValidator } from '@hono/zod-validator';
import {
  answerKeyVersionSchema,
  cutoffSchema,
  examinationPatternSchema,
  hostnameMatchesAuthority,
  isAllowedQuestionTransition,
  officialSourceSchema,
  noteSchema,
  questionReportSchema,
  reviewTransitionSchema,
  structuredImportSchema,
} from '@shared/content';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

interface AppEnvironment {
  Bindings: Env;
  Variables: { reviewerRef: string };
}

const now = () => new Date().toISOString();

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function parseStringArray(value: string): string[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new Error('Stored authority domains are invalid.');
  }
  return parsed;
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const contentRoutes = new Hono<AppEnvironment>();

contentRoutes.get('/api/content/overview', async (context) => {
  const { results } = await context.env.DB.prepare(
    `SELECT e.slug, e.short_name AS shortName, e.full_name AS fullName,
            e.qualification_level AS qualificationLevel,
            CASE WHEN EXISTS (
              SELECT 1 FROM questions q
              WHERE q.examination_id = e.id AND q.verification_status = 'published'
            ) THEN 'available' ELSE 'under_verification' END AS status,
            (SELECT COUNT(*) FROM questions q
             WHERE q.examination_id = e.id AND q.verification_status = 'published') AS publishedQuestions
       FROM examinations e WHERE e.enabled = 1 ORDER BY e.priority`,
  ).all();
  return context.json({ examinations: results }, 200, {
    'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
  });
});

contentRoutes.get('/api/content/authorities', async (context) => {
  const { results } = await context.env.DB.prepare(
    `SELECT name, domains_json AS domains FROM source_authorities
     WHERE enabled = 1 ORDER BY name`,
  ).all<{ name: string; domains: string }>();
  return context.json({
    authorities: results.map((row) => ({ name: row.name, domains: parseStringArray(row.domains) })),
  });
});

contentRoutes.get('/api/papers/recent', async (context) => {
  const { results } = await context.env.DB.prepare(
    `SELECT q.id, e.slug AS examinationSlug, e.short_name AS examination,
            q.year, q.exam_date AS examDate, q.shift, q.tier_stage AS tierStage,
            s.source_url AS sourceUrl, q.published_at AS publishedAt
       FROM questions q
       JOIN examinations e ON e.id = q.examination_id
       JOIN source_documents d ON d.id = q.document_id
       JOIN official_sources s ON s.id = d.source_id
      WHERE q.verification_status = 'published'
        AND q.content_origin = 'official_pyq'
        AND EXISTS (
          SELECT 1 FROM answer_key_versions k
           WHERE k.question_id = q.id AND k.key_type = 'final' AND k.is_current = 1
        )
      ORDER BY q.year DESC, q.exam_date DESC LIMIT 20`,
  ).all();
  return context.json({ papers: results });
});

contentRoutes.get('/api/questions/:id', async (context) => {
  const question = await context.env.DB.prepare(
    `SELECT q.id, e.slug AS examinationSlug, q.tier_stage AS tierStage, q.year,
            q.exam_date AS examDate, q.shift, q.section, q.subject, q.topic,
            q.subtopic, q.difficulty, q.question_text AS questionText,
            q.explanation_markdown AS explanationMarkdown,
            q.positive_marks AS positiveMarks, q.negative_marks AS negativeMarks,
            q.language, q.content_origin AS contentOrigin, q.source_page AS sourcePage,
            s.source_url AS sourceUrl,
            k.correct_option_index AS correctOptionIndex, k.key_type AS keyType
       FROM questions q
       JOIN examinations e ON e.id = q.examination_id
       JOIN source_documents d ON d.id = q.document_id
       JOIN official_sources s ON s.id = d.source_id
       JOIN answer_key_versions k ON k.question_id = q.id AND k.is_current = 1
      WHERE q.id = ? AND q.verification_status = 'published'
        AND ((q.content_origin = 'official_pyq' AND k.key_type = 'final')
          OR (q.content_origin <> 'official_pyq' AND k.key_type = 'editorial'))
      LIMIT 1`,
  )
    .bind(context.req.param('id'))
    .first();
  if (!question) throw new HTTPException(404, { message: 'Verified question not found.' });
  const { results: options } = await context.env.DB.prepare(
    `SELECT option_index AS optionIndex, option_text AS optionText
       FROM question_options WHERE question_id = ? ORDER BY option_index`,
  )
    .bind(context.req.param('id'))
    .all();
  return context.json({ ...question, options });
});

contentRoutes.post(
  '/api/questions/:id/reports',
  zValidator('json', questionReportSchema),
  async (context) => {
    const input = context.req.valid('json');
    const rateKey = `rate:report:${input.visitorUuid}:${new Date().toISOString().slice(0, 13)}`;
    const reportCount = Number((await context.env.PUBLIC_CACHE.get(rateKey)) ?? '0');
    if (reportCount >= 12)
      return context.json({ error: 'Question report rate limit reached.' }, 429);
    await context.env.PUBLIC_CACHE.put(rateKey, String(reportCount + 1), {
      expirationTtl: 3700,
    });
    const question = await context.env.DB.prepare(
      `SELECT id FROM questions WHERE id = ? AND verification_status = 'published'`,
    )
      .bind(context.req.param('id'))
      .first();
    if (!question) throw new HTTPException(404, { message: 'Verified question not found.' });
    const visitor = await context.env.DB.prepare(
      'SELECT visitor_number FROM anonymous_visitors WHERE visitor_uuid = ?',
    )
      .bind(input.visitorUuid)
      .first<{ visitor_number: number }>();
    if (!visitor) throw new HTTPException(404, { message: 'Anonymous visitor not found.' });
    await context.env.DB.prepare(
      `INSERT INTO question_reports
       (id, question_id, visitor_number, reason, detail, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?)`,
    )
      .bind(
        crypto.randomUUID(),
        context.req.param('id'),
        visitor.visitor_number,
        input.reason,
        input.detail ?? null,
        now(),
      )
      .run();
    return context.json({ status: 'received' }, 201);
  },
);

contentRoutes.get('/api/notes', async (context) => {
  const { results } = await context.env.DB.prepare(
    `SELECT n.id, e.slug AS examinationSlug, n.subject, n.topic, n.title,
            n.summary_markdown AS summaryMarkdown, n.language, n.published_at AS publishedAt
       FROM notes n JOIN examinations e ON e.id = n.examination_id
      WHERE n.verification_status = 'published'
        AND EXISTS (SELECT 1 FROM note_citations c WHERE c.note_id = n.id)
      ORDER BY n.published_at DESC LIMIT 50`,
  ).all();
  return context.json({ notes: results });
});

contentRoutes.get('/api/patterns/:slug', async (context) => {
  const { results } = await context.env.DB.prepare(
    `SELECT p.tier_stage AS tierStage, p.version, p.subjects_json AS subjects,
            p.sections_json AS sections, p.total_questions AS totalQuestions,
            p.total_marks AS totalMarks, p.negative_marking AS negativeMarking,
            p.standard_duration_minutes AS standardDurationMinutes,
            p.effective_from AS effectiveFrom, s.source_url AS sourceUrl
       FROM examination_patterns p
       JOIN examinations e ON e.id = p.examination_id
       JOIN official_sources s ON s.id = p.official_source_id
      WHERE e.slug = ? AND p.verification_status = 'verified_official' AND p.enabled = 1
      ORDER BY p.effective_from DESC`,
  )
    .bind(context.req.param('slug'))
    .all<Record<string, unknown> & { subjects: string; sections: string }>();
  return context.json({
    patterns: results.map((row) => ({
      ...row,
      subjects: parseJson(row.subjects),
      sections: parseJson(row.sections),
    })),
  });
});

contentRoutes.get('/api/cutoffs', async (context) => {
  const slug = context.req.query('exam');
  if (!slug) return context.json({ error: 'Examination is required.' }, 400);
  const { results } = await context.env.DB.prepare(
    `SELECT c.year, c.tier_stage AS tierStage, c.category, c.gender, c.post, c.region,
            c.score_type AS scoreType, c.cutoff_marks AS cutoffMarks,
            c.vacancy_count AS vacancyCount, s.source_url AS sourceUrl
       FROM cutoffs c
       JOIN examinations e ON e.id = c.examination_id
       JOIN official_sources s ON s.id = c.official_source_id
      WHERE e.slug = ? AND c.verification_status = 'verified_official'
      ORDER BY c.year DESC, c.category`,
  )
    .bind(slug)
    .all();
  return context.json({ cutoffs: results });
});

export const adminRoutes = new Hono<AppEnvironment>();

adminRoutes.get('/api/admin/status', (context) =>
  context.json({ status: 'protected', reviewerRef: context.get('reviewerRef') }),
);

adminRoutes.get('/api/admin/reports', async (context) => {
  const { results } = await context.env.DB.prepare(
    `SELECT id, question_id AS questionId, reason, detail, status, created_at AS createdAt
       FROM question_reports ORDER BY created_at DESC LIMIT 100`,
  ).all();
  return context.json({ reports: results });
});

adminRoutes.get('/api/admin/questions/:id/history', async (context) => {
  const { results } = await context.env.DB.prepare(
    `SELECT from_status AS fromStatus, to_status AS toStatus, reason,
            reviewer_ref AS reviewerRef, created_at AS createdAt
       FROM question_review_history WHERE question_id = ? ORDER BY created_at`,
  )
    .bind(context.req.param('id'))
    .all();
  return context.json({ history: results });
});

adminRoutes.post(
  '/api/admin/sources',
  zValidator('json', officialSourceSchema),
  async (context) => {
    const input = context.req.valid('json');
    const authority = await context.env.DB.prepare(
      'SELECT id, domains_json FROM source_authorities WHERE id = ? AND enabled = 1',
    )
      .bind(input.authorityId)
      .first<{ id: string; domains_json: string }>();
    if (!authority) throw new HTTPException(404, { message: 'Authority not found.' });
    if (!hostnameMatchesAuthority(input.sourceUrl, parseStringArray(authority.domains_json))) {
      return context.json({ error: 'Source URL is outside the authority allowlist.' }, 400);
    }
    let examinationId: string | null = null;
    if (input.examinationSlug) {
      const examination = await context.env.DB.prepare(
        'SELECT id FROM examinations WHERE slug = ? AND enabled = 1',
      )
        .bind(input.examinationSlug)
        .first<{ id: string }>();
      if (!examination) throw new HTTPException(404, { message: 'Examination not found.' });
      examinationId = examination.id;
    }
    const id = crypto.randomUUID();
    await context.env.DB.prepare(
      `INSERT INTO official_sources
       (id, authority_id, examination_id, content_type, source_url, retrieval_schedule,
        copyright_status, attribution_requirements, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        authority.id,
        examinationId,
        input.contentType,
        input.sourceUrl,
        input.retrievalSchedule ?? null,
        input.copyrightStatus,
        input.attributionRequirements ?? null,
        input.enabled ? 1 : 0,
        now(),
      )
      .run();
    return context.json({ id }, 201);
  },
);

adminRoutes.put('/api/admin/documents/:sha256', async (context) => {
  const digest = context.req.param('sha256');
  if (!/^[a-f0-9]{64}$/.test(digest)) return context.json({ error: 'Invalid SHA-256.' }, 400);
  const sourceId = context.req.header('x-source-id');
  const fileName = context.req.header('x-file-name');
  const pageCount = Number(context.req.header('x-page-count'));
  const contentLength = Number(context.req.header('content-length'));
  const mimeType = context.req.header('content-type')?.split(';')[0];
  if (
    !sourceId ||
    !fileName ||
    !Number.isInteger(pageCount) ||
    pageCount < 1 ||
    !Number.isInteger(contentLength) ||
    contentLength < 1 ||
    contentLength > 20 * 1024 * 1024 ||
    !mimeType ||
    !['application/pdf', 'image/png', 'image/jpeg'].includes(mimeType) ||
    !context.req.raw.body
  ) {
    return context.json({ error: 'Document metadata or body is invalid.' }, 400);
  }
  const existing = await context.env.DB.prepare('SELECT id FROM source_documents WHERE sha256 = ?')
    .bind(digest)
    .first();
  if (existing) return context.json({ error: 'Document already ingested.' }, 409);
  const source = await context.env.DB.prepare(
    `SELECT id FROM official_sources
      WHERE id = ? AND enabled = 1
        AND copyright_status IN ('official_publication', 'reproduction_permitted')`,
  )
    .bind(sourceId)
    .first();
  if (!source) return context.json({ error: 'Source does not permit managed storage.' }, 400);
  const extension =
    mimeType === 'application/pdf' ? 'pdf' : mimeType === 'image/png' ? 'png' : 'jpg';
  const r2Key = `sources/${digest}.${extension}`;
  await context.env.DOCUMENTS.put(r2Key, context.req.raw.body, {
    httpMetadata: {
      contentType: mimeType,
      contentDisposition: `attachment; filename="${fileName}"`,
    },
    customMetadata: { sourceId, sha256: digest },
  });
  const id = crypto.randomUUID();
  try {
    await context.env.DB.prepare(
      `INSERT INTO source_documents
       (id, source_id, sha256, r2_key, file_name, mime_type, byte_size, page_count,
        reproduction_status, retrieved_at, extraction_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'stored_permitted', ?, 'pending', ?)`,
    )
      .bind(id, sourceId, digest, r2Key, fileName, mimeType, contentLength, pageCount, now(), now())
      .run();
  } catch (error) {
    await context.env.DOCUMENTS.delete(r2Key);
    throw error;
  }
  return context.json({ id, sha256: digest }, 201);
});

adminRoutes.post(
  '/api/admin/patterns',
  zValidator('json', examinationPatternSchema),
  async (context) => {
    const input = context.req.valid('json');
    const examination = await context.env.DB.prepare('SELECT id FROM examinations WHERE slug = ?')
      .bind(input.examinationSlug)
      .first<{ id: string }>();
    if (!examination) throw new HTTPException(404, { message: 'Examination not found.' });
    const id = crypto.randomUUID();
    await context.env.DB.prepare(
      `INSERT INTO examination_patterns
       (id, examination_id, tier_stage, version, subjects_json, sections_json,
        total_questions, total_marks, marks_per_question, negative_marking,
        standard_duration_minutes, sectional_duration_json, language_rules_json,
        navigation_rules_json, qualification_stages_json, official_source_id,
        effective_from, verification_status, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    )
      .bind(
        id,
        examination.id,
        input.tierStage,
        input.version,
        JSON.stringify(input.subjects),
        JSON.stringify(input.sections),
        input.totalQuestions,
        input.totalMarks,
        input.marksPerQuestion,
        input.negativeMarking,
        input.standardDurationMinutes,
        input.sectionalDuration ? JSON.stringify(input.sectionalDuration) : null,
        JSON.stringify(input.languageRules),
        JSON.stringify(input.navigationRules),
        JSON.stringify(input.qualificationStages),
        input.officialSourceId,
        input.effectiveFrom,
        input.verificationStatus,
        now(),
      )
      .run();
    return context.json({ id }, 201);
  },
);

adminRoutes.post('/api/admin/cutoffs', zValidator('json', cutoffSchema), async (context) => {
  const input = context.req.valid('json');
  const examination = await context.env.DB.prepare('SELECT id FROM examinations WHERE slug = ?')
    .bind(input.examinationSlug)
    .first<{ id: string }>();
  if (!examination) throw new HTTPException(404, { message: 'Examination not found.' });
  const id = crypto.randomUUID();
  await context.env.DB.prepare(
    `INSERT INTO cutoffs
     (id, examination_id, year, tier_stage, category, gender, post, region, score_type,
      cutoff_marks, vacancy_count, official_source_id, verification_status, reviewer_ref,
      verified_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      examination.id,
      input.year,
      input.tierStage,
      input.category,
      input.gender ?? null,
      input.post ?? null,
      input.region ?? null,
      input.scoreType,
      input.cutoffMarks,
      input.vacancyCount ?? null,
      input.officialSourceId,
      input.verificationStatus,
      context.get('reviewerRef'),
      input.verificationStatus === 'verified_official' ? now() : null,
      now(),
    )
    .run();
  return context.json({ id }, 201);
});

adminRoutes.post('/api/admin/notes', zValidator('json', noteSchema), async (context) => {
  const input = context.req.valid('json');
  const examination = await context.env.DB.prepare('SELECT id FROM examinations WHERE slug = ?')
    .bind(input.examinationSlug)
    .first<{ id: string }>();
  if (!examination) throw new HTTPException(404, { message: 'Examination not found.' });
  const noteId = crypto.randomUUID();
  const createdAt = now();
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO notes
       (id, examination_id, subject, topic, title, summary_markdown, language,
        verification_status, related_topics_json, last_updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'needs_review', ?, ?, ?)`,
    ).bind(
      noteId,
      examination.id,
      input.subject,
      input.topic,
      input.title,
      input.summaryMarkdown,
      input.language,
      JSON.stringify(input.relatedTopics),
      createdAt,
      createdAt,
    ),
    ...input.citations.map((citation) =>
      context.env.DB.prepare(
        `INSERT INTO note_citations (id, note_id, source_id, label, source_page)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        noteId,
        citation.sourceId,
        citation.label,
        citation.sourcePage ?? null,
      ),
    ),
    ...input.relatedQuestionIds.map((questionId) =>
      context.env.DB.prepare(
        'INSERT INTO note_related_questions (note_id, question_id) VALUES (?, ?)',
      ).bind(noteId, questionId),
    ),
  ]);
  return context.json({ id: noteId, status: 'needs_review' }, 201);
});

adminRoutes.post('/api/admin/notes/:id/review', async (context) => {
  const body = await context.req.json<{ toStatus?: string }>();
  if (!['verified_editorial', 'published', 'archived'].includes(body.toStatus ?? '')) {
    return context.json({ error: 'Invalid note review status.' }, 400);
  }
  const note = await context.env.DB.prepare('SELECT verification_status FROM notes WHERE id = ?')
    .bind(context.req.param('id'))
    .first<{ verification_status: string }>();
  if (!note) throw new HTTPException(404, { message: 'Note not found.' });
  const allowed =
    (note.verification_status === 'needs_review' && body.toStatus === 'verified_editorial') ||
    (note.verification_status === 'verified_editorial' && body.toStatus === 'published') ||
    body.toStatus === 'archived';
  if (!allowed) return context.json({ error: 'Note review transition is not allowed.' }, 409);
  await context.env.DB.prepare(
    `UPDATE notes SET verification_status = ?, reviewer_ref = ?, last_updated_at = ?,
      published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END WHERE id = ?`,
  )
    .bind(
      body.toStatus,
      context.get('reviewerRef'),
      now(),
      body.toStatus,
      now(),
      context.req.param('id'),
    )
    .run();
  return context.json({ status: body.toStatus });
});

adminRoutes.post(
  '/api/admin/imports/questions',
  zValidator('json', structuredImportSchema),
  async (context) => {
    const input = context.req.valid('json');
    const document = await context.env.DB.prepare(
      'SELECT id FROM source_documents WHERE sha256 = ?',
    )
      .bind(input.documentSha256)
      .first<{ id: string }>();
    if (!document) throw new HTTPException(404, { message: 'Source document not found.' });

    const runId = crypto.randomUUID();
    const statements: D1PreparedStatement[] = [
      context.env.DB.prepare(
        `INSERT INTO ingestion_runs
         (id, document_id, status, parser_version, ocr_used, started_at)
         VALUES (?, ?, 'running', ?, ?, ?)`,
      ).bind(runId, document.id, input.parserVersion, input.ocrUsed ? 1 : 0, now()),
    ];
    const ids: string[] = [];
    for (const question of input.questions) {
      const examination = await context.env.DB.prepare(
        'SELECT id, qualification_level FROM examinations WHERE slug = ? AND enabled = 1',
      )
        .bind(question.examinationSlug)
        .first<{ id: string; qualification_level: string }>();
      if (examination?.qualification_level !== question.qualificationLevel) {
        return context.json(
          { error: `Invalid examination mapping: ${question.examinationSlug}` },
          400,
        );
      }
      const canonical = JSON.stringify({
        document: input.documentSha256,
        examination: question.examinationSlug,
        question: question.questionText.trim(),
        options: question.options.map((option) => option.trim()),
        page: question.sourcePage,
      });
      const contentHash = await sha256(canonical);
      const duplicate = await context.env.DB.prepare(
        'SELECT id FROM questions WHERE content_hash = ?',
      )
        .bind(contentHash)
        .first();
      if (duplicate) return context.json({ error: 'Duplicate question detected.' }, 409);
      const questionId = crypto.randomUUID();
      ids.push(questionId);
      statements.push(
        context.env.DB.prepare(
          `INSERT INTO questions
           (id, document_id, examination_id, qualification_level, tier_stage, year,
            exam_date, shift, section, subject, topic, subtopic, difficulty,
            question_text, explanation_markdown, positive_marks, negative_marks, source_page,
            official_question_id, language, content_origin, verification_status,
            content_hash, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'imported', ?, ?)`,
        ).bind(
          questionId,
          document.id,
          examination.id,
          question.qualificationLevel,
          question.tierStage,
          question.year,
          question.examDate ?? null,
          question.shift ?? null,
          question.section,
          question.subject,
          question.topic,
          question.subtopic ?? null,
          question.difficulty,
          question.questionText,
          question.explanationMarkdown ?? null,
          question.positiveMarks,
          question.negativeMarks,
          question.sourcePage,
          question.officialQuestionId ?? null,
          question.language,
          question.contentOrigin,
          contentHash,
          now(),
        ),
      );
      question.options.forEach((option, index) => {
        statements.push(
          context.env.DB.prepare(
            'INSERT INTO question_options (id, question_id, option_index, option_text) VALUES (?, ?, ?, ?)',
          ).bind(crypto.randomUUID(), questionId, index, option),
        );
      });
      statements.push(
        context.env.DB.prepare(
          `INSERT INTO question_review_history
           (id, question_id, from_status, to_status, reason, reviewer_ref, created_at)
           VALUES (?, ?, NULL, 'imported', 'Structured source import', ?, ?)`,
        ).bind(crypto.randomUUID(), questionId, context.get('reviewerRef'), now()),
      );
    }
    statements.push(
      context.env.DB.prepare(
        `UPDATE ingestion_runs SET status = 'completed', completed_at = ? WHERE id = ?`,
      ).bind(now(), runId),
      context.env.DB.prepare(
        `UPDATE source_documents SET extraction_status = 'completed' WHERE id = ?`,
      ).bind(document.id),
    );
    await context.env.DB.batch(statements);
    return context.json({ ingestionRunId: runId, questionIds: ids }, 201);
  },
);

adminRoutes.post(
  '/api/admin/questions/:id/answer-keys',
  zValidator('json', answerKeyVersionSchema),
  async (context) => {
    const input = context.req.valid('json');
    const questionId = context.req.param('id');
    const question = await context.env.DB.prepare(
      'SELECT id, verification_status FROM questions WHERE id = ?',
    )
      .bind(questionId)
      .first<{ id: string; verification_status: string }>();
    if (!question) throw new HTTPException(404, { message: 'Question not found.' });
    const source = await context.env.DB.prepare(
      'SELECT content_type FROM official_sources WHERE id = ? AND enabled = 1',
    )
      .bind(input.sourceId)
      .first<{ content_type: string }>();
    const requiredType =
      input.keyType === 'final'
        ? 'final_answer_key'
        : input.keyType === 'tentative'
          ? 'tentative_answer_key'
          : 'licensed_note_source';
    if (source?.content_type !== requiredType) {
      return context.json({ error: 'Answer-key type does not match its source.' }, 400);
    }
    const current = await context.env.DB.prepare(
      `SELECT correct_option_index FROM answer_key_versions
        WHERE question_id = ? AND key_type = ? AND is_current = 1`,
    )
      .bind(questionId, input.keyType)
      .first<{ correct_option_index: number }>();
    if (current && current.correct_option_index !== input.correctOptionIndex) {
      await context.env.DB.batch([
        context.env.DB.prepare(
          `INSERT INTO answer_key_versions
           (id, question_id, source_id, key_type, version_label, correct_option_index,
            is_current, reviewer_ref, effective_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          questionId,
          input.sourceId,
          input.keyType,
          input.versionLabel,
          input.correctOptionIndex,
          context.get('reviewerRef'),
          input.effectiveAt,
          now(),
        ),
        context.env.DB.prepare(
          `UPDATE questions SET verification_status = 'disputed' WHERE id = ?`,
        ).bind(questionId),
        context.env.DB.prepare(
          `INSERT INTO question_review_history
           (id, question_id, from_status, to_status, reason, reviewer_ref, created_at)
           VALUES (?, ?, ?, 'disputed', 'Conflicting answer-key versions', ?, ?)`,
        ).bind(
          crypto.randomUUID(),
          questionId,
          question.verification_status,
          context.get('reviewerRef'),
          now(),
        ),
      ]);
      return context.json({ status: 'disputed', error: 'Conflicting answer-key version.' }, 409);
    }
    await context.env.DB.batch([
      context.env.DB.prepare(
        'UPDATE answer_key_versions SET is_current = 0 WHERE question_id = ? AND key_type = ?',
      ).bind(questionId, input.keyType),
      context.env.DB.prepare(
        `INSERT INTO answer_key_versions
         (id, question_id, source_id, key_type, version_label, correct_option_index,
          is_current, reviewer_ref, effective_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        questionId,
        input.sourceId,
        input.keyType,
        input.versionLabel,
        input.correctOptionIndex,
        context.get('reviewerRef'),
        input.effectiveAt,
        now(),
      ),
    ]);
    return context.json({ status: 'versioned' }, 201);
  },
);

adminRoutes.post(
  '/api/admin/questions/:id/review',
  zValidator('json', reviewTransitionSchema),
  async (context) => {
    const input = context.req.valid('json');
    const questionId = context.req.param('id');
    const question = await context.env.DB.prepare(
      'SELECT verification_status FROM questions WHERE id = ?',
    )
      .bind(questionId)
      .first<{ verification_status: string }>();
    if (!question) throw new HTTPException(404, { message: 'Question not found.' });
    if (!isAllowedQuestionTransition(question.verification_status, input.toStatus)) {
      return context.json({ error: 'Review transition is not allowed.' }, 409);
    }
    const reviewedAt = now();
    await context.env.DB.batch([
      context.env.DB.prepare(
        `UPDATE questions
            SET verification_status = ?, reviewer_ref = ?, last_verified_at = ?,
                published_at = CASE WHEN ? = 'published' THEN ? ELSE published_at END
          WHERE id = ?`,
      ).bind(
        input.toStatus,
        context.get('reviewerRef'),
        reviewedAt,
        input.toStatus,
        reviewedAt,
        questionId,
      ),
      context.env.DB.prepare(
        `INSERT INTO question_review_history
         (id, question_id, from_status, to_status, reason, reviewer_ref, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        questionId,
        question.verification_status,
        input.toStatus,
        input.reason,
        context.get('reviewerRef'),
        reviewedAt,
      ),
    ]);
    return context.json({ status: input.toStatus });
  },
);
