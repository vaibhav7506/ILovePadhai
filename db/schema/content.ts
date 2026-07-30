import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const examinations = sqliteTable(
  'examinations',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    shortName: text('short_name').notNull(),
    fullName: text('full_name').notNull(),
    qualificationLevel: text('qualification_level', {
      enum: ['secondary', 'graduate'],
    }).notNull(),
    contentStatus: text('content_status', {
      enum: ['under_verification', 'available'],
    })
      .notNull()
      .default('under_verification'),
    priority: integer('priority').notNull().default(100),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('examinations_slug_unique').on(table.slug)],
);

export const sourceAuthorities = sqliteTable(
  'source_authorities',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    domainsJson: text('domains_json').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
  },
  (table) => [uniqueIndex('source_authorities_slug_unique').on(table.slug)],
);

export const officialSources = sqliteTable(
  'official_sources',
  {
    id: text('id').primaryKey(),
    authorityId: text('authority_id')
      .notNull()
      .references(() => sourceAuthorities.id),
    examinationId: text('examination_id').references(() => examinations.id),
    contentType: text('content_type').notNull(),
    sourceUrl: text('source_url').notNull(),
    retrievalSchedule: text('retrieval_schedule'),
    lastCheckedAt: text('last_checked_at'),
    lastChangedAt: text('last_changed_at'),
    contentHash: text('content_hash'),
    copyrightStatus: text('copyright_status').notNull(),
    attributionRequirements: text('attribution_requirements'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('official_sources_url_unique').on(table.sourceUrl),
    index('official_sources_authority_idx').on(table.authorityId),
    index('official_sources_exam_type_idx').on(table.examinationId, table.contentType),
  ],
);

export const sourceDocuments = sqliteTable(
  'source_documents',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => officialSources.id),
    sha256: text('sha256').notNull(),
    r2Key: text('r2_key'),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    byteSize: integer('byte_size').notNull(),
    pageCount: integer('page_count'),
    reproductionStatus: text('reproduction_status').notNull(),
    retrievedAt: text('retrieved_at').notNull(),
    extractionStatus: text('extraction_status').notNull().default('pending'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('source_documents_sha256_unique').on(table.sha256),
    uniqueIndex('source_documents_r2_key_unique').on(table.r2Key),
    index('source_documents_source_idx').on(table.sourceId),
  ],
);

export const ingestionRuns = sqliteTable(
  'ingestion_runs',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => sourceDocuments.id),
    status: text('status').notNull(),
    parserVersion: text('parser_version').notNull(),
    ocrUsed: integer('ocr_used', { mode: 'boolean' }).notNull().default(false),
    extractedJsonKey: text('extracted_json_key'),
    errorSummary: text('error_summary'),
    startedAt: text('started_at').notNull(),
    completedAt: text('completed_at'),
  },
  (table) => [index('ingestion_runs_document_idx').on(table.documentId)],
);

export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    documentId: text('document_id')
      .notNull()
      .references(() => sourceDocuments.id),
    examinationId: text('examination_id')
      .notNull()
      .references(() => examinations.id),
    qualificationLevel: text('qualification_level').notNull(),
    tierStage: text('tier_stage').notNull(),
    year: integer('year').notNull(),
    examDate: text('exam_date'),
    shift: text('shift'),
    section: text('section').notNull(),
    subject: text('subject').notNull(),
    topic: text('topic').notNull(),
    subtopic: text('subtopic'),
    difficulty: text('difficulty').notNull(),
    questionType: text('question_type').notNull().default('single_choice_mcq'),
    questionText: text('question_text').notNull(),
    explanationMarkdown: text('explanation_markdown'),
    positiveMarks: real('positive_marks').notNull(),
    negativeMarks: real('negative_marks').notNull(),
    sourcePage: integer('source_page').notNull(),
    officialQuestionId: text('official_question_id'),
    language: text('language').notNull(),
    contentOrigin: text('content_origin').notNull(),
    verificationStatus: text('verification_status').notNull().default('imported'),
    contentHash: text('content_hash').notNull(),
    reviewerRef: text('reviewer_ref'),
    lastVerifiedAt: text('last_verified_at'),
    publishedAt: text('published_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('questions_content_hash_unique').on(table.contentHash),
    uniqueIndex('questions_document_official_id_unique').on(
      table.documentId,
      table.officialQuestionId,
    ),
    index('questions_public_lookup_idx').on(
      table.examinationId,
      table.verificationStatus,
      table.year,
    ),
    index('questions_topic_idx').on(table.subject, table.topic),
  ],
);

export const questionOptions = sqliteTable(
  'question_options',
  {
    id: text('id').primaryKey(),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    optionIndex: integer('option_index').notNull(),
    optionText: text('option_text').notNull(),
  },
  (table) => [
    uniqueIndex('question_options_question_index_unique').on(table.questionId, table.optionIndex),
  ],
);

export const answerKeyVersions = sqliteTable(
  'answer_key_versions',
  {
    id: text('id').primaryKey(),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => officialSources.id),
    keyType: text('key_type').notNull(),
    versionLabel: text('version_label').notNull(),
    correctOptionIndex: integer('correct_option_index').notNull(),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(true),
    reviewerRef: text('reviewer_ref').notNull(),
    effectiveAt: text('effective_at').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('answer_key_versions_question_label_unique').on(
      table.questionId,
      table.versionLabel,
    ),
    index('answer_key_versions_current_idx').on(table.questionId, table.keyType, table.isCurrent),
  ],
);

export const questionReviewHistory = sqliteTable(
  'question_review_history',
  {
    id: text('id').primaryKey(),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    reason: text('reason').notNull(),
    reviewerRef: text('reviewer_ref').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('question_review_history_question_idx').on(table.questionId)],
);

export const examinationPatterns = sqliteTable(
  'examination_patterns',
  {
    id: text('id').primaryKey(),
    examinationId: text('examination_id')
      .notNull()
      .references(() => examinations.id),
    tierStage: text('tier_stage').notNull(),
    version: text('version').notNull(),
    subjectsJson: text('subjects_json').notNull(),
    sectionsJson: text('sections_json').notNull(),
    totalQuestions: integer('total_questions').notNull(),
    totalMarks: real('total_marks').notNull(),
    marksPerQuestion: real('marks_per_question').notNull(),
    negativeMarking: real('negative_marking').notNull(),
    standardDurationMinutes: integer('standard_duration_minutes').notNull(),
    sectionalDurationJson: text('sectional_duration_json'),
    languageRulesJson: text('language_rules_json').notNull(),
    navigationRulesJson: text('navigation_rules_json').notNull(),
    qualificationStagesJson: text('qualification_stages_json').notNull(),
    officialSourceId: text('official_source_id')
      .notNull()
      .references(() => officialSources.id),
    effectiveFrom: text('effective_from').notNull(),
    verificationStatus: text('verification_status').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('examination_patterns_version_unique').on(
      table.examinationId,
      table.tierStage,
      table.version,
    ),
  ],
);

export const cutoffs = sqliteTable(
  'cutoffs',
  {
    id: text('id').primaryKey(),
    examinationId: text('examination_id')
      .notNull()
      .references(() => examinations.id),
    year: integer('year').notNull(),
    tierStage: text('tier_stage').notNull(),
    category: text('category').notNull(),
    gender: text('gender'),
    post: text('post'),
    region: text('region'),
    scoreType: text('score_type').notNull(),
    cutoffMarks: real('cutoff_marks').notNull(),
    vacancyCount: integer('vacancy_count'),
    officialSourceId: text('official_source_id')
      .notNull()
      .references(() => officialSources.id),
    verificationStatus: text('verification_status').notNull(),
    reviewerRef: text('reviewer_ref'),
    verifiedAt: text('verified_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('cutoffs_lookup_idx').on(
      table.examinationId,
      table.year,
      table.tierStage,
      table.category,
    ),
  ],
);

export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    examinationId: text('examination_id')
      .notNull()
      .references(() => examinations.id),
    subject: text('subject').notNull(),
    topic: text('topic').notNull(),
    title: text('title').notNull(),
    summaryMarkdown: text('summary_markdown').notNull(),
    relatedTopicsJson: text('related_topics_json').notNull().default('[]'),
    language: text('language').notNull(),
    verificationStatus: text('verification_status').notNull(),
    reviewerRef: text('reviewer_ref'),
    lastUpdatedAt: text('last_updated_at').notNull(),
    publishedAt: text('published_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('notes_public_lookup_idx').on(
      table.examinationId,
      table.verificationStatus,
      table.subject,
      table.topic,
    ),
  ],
);

export const noteCitations = sqliteTable(
  'note_citations',
  {
    id: text('id').primaryKey(),
    noteId: text('note_id')
      .notNull()
      .references(() => notes.id, { onDelete: 'cascade' }),
    sourceId: text('source_id')
      .notNull()
      .references(() => officialSources.id),
    label: text('label').notNull(),
    sourcePage: integer('source_page'),
  },
  (table) => [index('note_citations_note_idx').on(table.noteId)],
);

export const questionReports = sqliteTable(
  'question_reports',
  {
    id: text('id').primaryKey(),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id),
    visitorNumber: integer('visitor_number').notNull(),
    reason: text('reason').notNull(),
    detail: text('detail'),
    status: text('status').notNull().default('open'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('question_reports_visitor_question_unique').on(
      table.questionId,
      table.visitorNumber,
    ),
  ],
);

export const attempts = sqliteTable(
  'attempts',
  {
    id: text('id').primaryKey(),
    visitorNumber: integer('visitor_number').notNull(),
    examinationId: text('examination_id')
      .notNull()
      .references(() => examinations.id),
    patternId: text('pattern_id').references(() => examinationPatterns.id),
    mode: text('mode').notNull(),
    tierStage: text('tier_stage').notNull(),
    nickname: text('nickname'),
    category: text('category'),
    region: text('region'),
    selectionJson: text('selection_json').notNull(),
    status: text('status').notNull().default('active'),
    questionCount: integer('question_count').notNull(),
    durationSeconds: integer('duration_seconds').notNull(),
    startedAt: text('started_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    submittedAt: text('submitted_at'),
    submissionReason: text('submission_reason'),
    scoreJson: text('score_json'),
    comparisonKey: text('comparison_key'),
    integrityStatus: text('integrity_status').notNull().default('legitimate'),
    integrityFlagsJson: text('integrity_flags_json').notNull().default('[]'),
    answerChangeCount: integer('answer_change_count').notNull().default(0),
    postName: text('post_name'),
    stageName: text('stage_name'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('attempts_visitor_status_idx').on(table.visitorNumber, table.status, table.createdAt),
  ],
);

export const attemptQuestions = sqliteTable(
  'attempt_questions',
  {
    attemptId: text('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id),
    position: integer('position').notNull(),
    section: text('section').notNull(),
    subject: text('subject').notNull().default('General'),
    topic: text('topic').notNull(),
    difficulty: text('difficulty').notNull().default('unrated'),
    positiveMarks: real('positive_marks').notNull(),
    negativeMarks: real('negative_marks').notNull(),
  },
  (table) => [
    uniqueIndex('attempt_questions_attempt_position_unique').on(table.attemptId, table.position),
    uniqueIndex('attempt_questions_attempt_question_unique').on(table.attemptId, table.questionId),
  ],
);

export const attemptResponses = sqliteTable(
  'attempt_responses',
  {
    attemptId: text('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id),
    selectedOptionIndex: integer('selected_option_index'),
    markedForReview: integer('marked_for_review', { mode: 'boolean' }).notNull().default(false),
    visited: integer('visited', { mode: 'boolean' }).notNull().default(false),
    clientElapsedSeconds: integer('client_elapsed_seconds').notNull().default(0),
    timeSpentSeconds: integer('time_spent_seconds').notNull().default(0),
    clientRevision: integer('client_revision').notNull().default(0),
    mutationId: text('mutation_id'),
    serverUpdatedAt: text('server_updated_at'),
  },
  (table) => [
    uniqueIndex('attempt_responses_attempt_question_unique').on(table.attemptId, table.questionId),
  ],
);

export const attemptQuestionResults = sqliteTable(
  'attempt_question_results',
  {
    attemptId: text('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id),
    selectedOptionIndex: integer('selected_option_index'),
    correctOptionIndex: integer('correct_option_index').notNull(),
    outcome: text('outcome').notNull(),
    scoreAwarded: real('score_awarded').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('attempt_question_results_attempt_question_unique').on(
      table.attemptId,
      table.questionId,
    ),
  ],
);

export const studyProfiles = sqliteTable('study_profiles', {
  visitorNumber: integer('visitor_number').primaryKey(),
  targetExaminationId: text('target_examination_id').references(() => examinations.id),
  expectedExamDate: text('expected_exam_date'),
  dailyMinutes: integer('daily_minutes').notNull().default(60),
  planPaused: integer('plan_paused', { mode: 'boolean' }).notNull().default(false),
  currentStreak: integer('current_streak').notNull().default(0),
  lastStudyDate: text('last_study_date'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const topicMastery = sqliteTable(
  'topic_mastery',
  {
    visitorNumber: integer('visitor_number').notNull(),
    examinationId: text('examination_id')
      .notNull()
      .references(() => examinations.id),
    subject: text('subject').notNull(),
    topic: text('topic').notNull(),
    questionsSeen: integer('questions_seen').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    incorrectCount: integer('incorrect_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    totalTimeSeconds: integer('total_time_seconds').notNull().default(0),
    masteryScore: real('mastery_score').notNull().default(0),
    lastPractisedAt: text('last_practised_at').notNull(),
  },
  (table) => [
    uniqueIndex('topic_mastery_identity_unique').on(
      table.visitorNumber,
      table.examinationId,
      table.subject,
      table.topic,
    ),
    index('topic_mastery_weak_idx').on(
      table.visitorNumber,
      table.examinationId,
      table.masteryScore,
      table.lastPractisedAt,
    ),
  ],
);

export const mistakeNotebook = sqliteTable(
  'mistake_notebook',
  {
    visitorNumber: integer('visitor_number').notNull(),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id),
    attemptId: text('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    sourceOutcome: text('source_outcome').notNull(),
    mistakeReason: text('mistake_reason'),
    revisionStatus: text('revision_status').notNull().default('due'),
    confidence: integer('confidence'),
    intervalDays: integer('interval_days').notNull().default(1),
    reviewCount: integer('review_count').notNull().default(0),
    nextReviewAt: text('next_review_at').notNull(),
    lastReviewedAt: text('last_reviewed_at'),
    bookmarked: integer('bookmarked', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('mistake_notebook_identity_unique').on(table.visitorNumber, table.questionId),
    index('mistake_notebook_revision_idx').on(
      table.visitorNumber,
      table.revisionStatus,
      table.nextReviewAt,
    ),
  ],
);

export const studyPlanItems = sqliteTable(
  'study_plan_items',
  {
    id: text('id').primaryKey(),
    visitorNumber: integer('visitor_number').notNull(),
    planDate: text('plan_date').notNull(),
    itemType: text('item_type').notNull(),
    subject: text('subject'),
    topic: text('topic'),
    minutes: integer('minutes').notNull(),
    rationale: text('rationale').notNull(),
    status: text('status').notNull().default('planned'),
    completedAt: text('completed_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('study_plan_items_day_idx').on(table.visitorNumber, table.planDate, table.status),
  ],
);

export const currentAffairs = sqliteTable(
  'current_affairs',
  {
    id: text('id').primaryKey(),
    headline: text('headline').notNull(),
    summary: text('summary').notNull(),
    topic: text('topic').notNull(),
    examinationRelevanceJson: text('examination_relevance_json').notNull(),
    language: text('language').notNull(),
    sourceUrl: text('source_url').notNull(),
    sourceTitle: text('source_title').notNull(),
    publishedOn: text('published_on').notNull(),
    verificationStatus: text('verification_status').notNull(),
    verifiedAt: text('verified_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('current_affairs_public_idx').on(
      table.verificationStatus,
      table.publishedOn,
      table.topic,
    ),
  ],
);

export const examCalendarEvents = sqliteTable(
  'exam_calendar_events',
  {
    id: text('id').primaryKey(),
    examinationId: text('examination_id')
      .notNull()
      .references(() => examinations.id),
    eventType: text('event_type').notNull(),
    title: text('title').notNull(),
    startsOn: text('starts_on').notNull(),
    endsOn: text('ends_on'),
    sourceUrl: text('source_url').notNull(),
    verificationStatus: text('verification_status').notNull(),
    verifiedAt: text('verified_at'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [
    index('exam_calendar_public_idx').on(
      table.verificationStatus,
      table.startsOn,
      table.examinationId,
    ),
  ],
);

export const aiUsageLogs = sqliteTable(
  'ai_usage_logs',
  {
    id: text('id').primaryKey(),
    visitorNumber: integer('visitor_number'),
    feature: text('feature').notNull(),
    model: text('model'),
    status: text('status').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    createdAt: text('created_at').notNull(),
  },
  (table) => [index('ai_usage_logs_day_idx').on(table.createdAt, table.feature, table.status)],
);
