PRAGMA defer_foreign_keys = ON;

CREATE TABLE `examinations` (
  `id` text PRIMARY KEY NOT NULL,
  `slug` text NOT NULL,
  `short_name` text NOT NULL,
  `full_name` text NOT NULL,
  `qualification_level` text NOT NULL CHECK (`qualification_level` IN ('secondary', 'graduate')),
  `content_status` text DEFAULT 'under_verification' NOT NULL CHECK (`content_status` IN ('under_verification', 'available')),
  `priority` integer DEFAULT 100 NOT NULL,
  `enabled` integer DEFAULT true NOT NULL CHECK (`enabled` IN (0, 1)),
  `created_at` text NOT NULL
);
CREATE UNIQUE INDEX `examinations_slug_unique` ON `examinations` (`slug`);

CREATE TABLE `source_authorities` (
  `id` text PRIMARY KEY NOT NULL,
  `slug` text NOT NULL,
  `name` text NOT NULL,
  `domains_json` text NOT NULL CHECK (json_valid(`domains_json`)),
  `enabled` integer DEFAULT true NOT NULL CHECK (`enabled` IN (0, 1)),
  `created_at` text NOT NULL
);
CREATE UNIQUE INDEX `source_authorities_slug_unique` ON `source_authorities` (`slug`);

CREATE TABLE `official_sources` (
  `id` text PRIMARY KEY NOT NULL,
  `authority_id` text NOT NULL,
  `examination_id` text,
  `content_type` text NOT NULL,
  `source_url` text NOT NULL,
  `retrieval_schedule` text,
  `last_checked_at` text,
  `last_changed_at` text,
  `content_hash` text,
  `copyright_status` text NOT NULL,
  `attribution_requirements` text,
  `enabled` integer DEFAULT true NOT NULL CHECK (`enabled` IN (0, 1)),
  `created_at` text NOT NULL,
  FOREIGN KEY (`authority_id`) REFERENCES `source_authorities` (`id`),
  FOREIGN KEY (`examination_id`) REFERENCES `examinations` (`id`)
);
CREATE UNIQUE INDEX `official_sources_url_unique` ON `official_sources` (`source_url`);
CREATE INDEX `official_sources_authority_idx` ON `official_sources` (`authority_id`);
CREATE INDEX `official_sources_exam_type_idx` ON `official_sources` (`examination_id`, `content_type`);

CREATE TABLE `source_documents` (
  `id` text PRIMARY KEY NOT NULL,
  `source_id` text NOT NULL,
  `sha256` text NOT NULL CHECK (length(`sha256`) = 64),
  `r2_key` text,
  `file_name` text NOT NULL,
  `mime_type` text NOT NULL,
  `byte_size` integer NOT NULL CHECK (`byte_size` > 0),
  `page_count` integer CHECK (`page_count` > 0),
  `reproduction_status` text NOT NULL,
  `retrieved_at` text NOT NULL,
  `extraction_status` text DEFAULT 'pending' NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`source_id`) REFERENCES `official_sources` (`id`)
);
CREATE UNIQUE INDEX `source_documents_sha256_unique` ON `source_documents` (`sha256`);
CREATE UNIQUE INDEX `source_documents_r2_key_unique` ON `source_documents` (`r2_key`);
CREATE INDEX `source_documents_source_idx` ON `source_documents` (`source_id`);

CREATE TABLE `ingestion_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `status` text NOT NULL,
  `parser_version` text NOT NULL,
  `ocr_used` integer DEFAULT false NOT NULL CHECK (`ocr_used` IN (0, 1)),
  `extracted_json_key` text,
  `error_summary` text,
  `started_at` text NOT NULL,
  `completed_at` text,
  FOREIGN KEY (`document_id`) REFERENCES `source_documents` (`id`)
);
CREATE INDEX `ingestion_runs_document_idx` ON `ingestion_runs` (`document_id`);

CREATE TABLE `questions` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `examination_id` text NOT NULL,
  `qualification_level` text NOT NULL,
  `tier_stage` text NOT NULL,
  `year` integer NOT NULL CHECK (`year` BETWEEN 1950 AND 2200),
  `exam_date` text,
  `shift` text,
  `section` text NOT NULL,
  `subject` text NOT NULL,
  `topic` text NOT NULL,
  `subtopic` text,
  `difficulty` text NOT NULL CHECK (`difficulty` IN ('easy', 'moderate', 'hard', 'unrated')),
  `question_type` text DEFAULT 'single_choice_mcq' NOT NULL CHECK (`question_type` = 'single_choice_mcq'),
  `question_text` text NOT NULL,
  `positive_marks` real NOT NULL CHECK (`positive_marks` >= 0),
  `negative_marks` real NOT NULL CHECK (`negative_marks` >= 0),
  `source_page` integer NOT NULL CHECK (`source_page` > 0),
  `official_question_id` text,
  `language` text NOT NULL CHECK (`language` IN ('en', 'hi', 'bilingual')),
  `content_origin` text NOT NULL CHECK (`content_origin` IN ('official_pyq', 'editorial', 'ai_generated_practice')),
  `verification_status` text DEFAULT 'imported' NOT NULL CHECK (`verification_status` IN ('imported', 'needs_review', 'tentative_key', 'verified_official', 'verified_editorial', 'disputed', 'rejected', 'published', 'archived')),
  `content_hash` text NOT NULL,
  `reviewer_ref` text,
  `last_verified_at` text,
  `published_at` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`document_id`) REFERENCES `source_documents` (`id`),
  FOREIGN KEY (`examination_id`) REFERENCES `examinations` (`id`)
);
CREATE UNIQUE INDEX `questions_content_hash_unique` ON `questions` (`content_hash`);
CREATE UNIQUE INDEX `questions_document_official_id_unique` ON `questions` (`document_id`, `official_question_id`);
CREATE INDEX `questions_public_lookup_idx` ON `questions` (`examination_id`, `verification_status`, `year`);
CREATE INDEX `questions_topic_idx` ON `questions` (`subject`, `topic`);

CREATE TABLE `question_options` (
  `id` text PRIMARY KEY NOT NULL,
  `question_id` text NOT NULL,
  `option_index` integer NOT NULL CHECK (`option_index` BETWEEN 0 AND 3),
  `option_text` text NOT NULL,
  FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX `question_options_question_index_unique` ON `question_options` (`question_id`, `option_index`);

CREATE TABLE `answer_key_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `question_id` text NOT NULL,
  `source_id` text NOT NULL,
  `key_type` text NOT NULL CHECK (`key_type` IN ('tentative', 'final', 'editorial')),
  `version_label` text NOT NULL,
  `correct_option_index` integer NOT NULL CHECK (`correct_option_index` BETWEEN 0 AND 3),
  `is_current` integer DEFAULT true NOT NULL CHECK (`is_current` IN (0, 1)),
  `reviewer_ref` text NOT NULL,
  `effective_at` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`source_id`) REFERENCES `official_sources` (`id`)
);
CREATE UNIQUE INDEX `answer_key_versions_question_label_unique` ON `answer_key_versions` (`question_id`, `version_label`);
CREATE INDEX `answer_key_versions_current_idx` ON `answer_key_versions` (`question_id`, `key_type`, `is_current`);

CREATE TABLE `question_review_history` (
  `id` text PRIMARY KEY NOT NULL,
  `question_id` text NOT NULL,
  `from_status` text,
  `to_status` text NOT NULL,
  `reason` text NOT NULL,
  `reviewer_ref` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`) ON DELETE CASCADE
);
CREATE INDEX `question_review_history_question_idx` ON `question_review_history` (`question_id`);

CREATE TABLE `examination_patterns` (
  `id` text PRIMARY KEY NOT NULL,
  `examination_id` text NOT NULL,
  `tier_stage` text NOT NULL,
  `version` text NOT NULL,
  `subjects_json` text NOT NULL CHECK (json_valid(`subjects_json`)),
  `sections_json` text NOT NULL CHECK (json_valid(`sections_json`)),
  `total_questions` integer NOT NULL CHECK (`total_questions` > 0),
  `total_marks` real NOT NULL CHECK (`total_marks` > 0),
  `marks_per_question` real NOT NULL CHECK (`marks_per_question` >= 0),
  `negative_marking` real NOT NULL CHECK (`negative_marking` >= 0),
  `standard_duration_minutes` integer NOT NULL CHECK (`standard_duration_minutes` > 0),
  `sectional_duration_json` text CHECK (`sectional_duration_json` IS NULL OR json_valid(`sectional_duration_json`)),
  `language_rules_json` text NOT NULL CHECK (json_valid(`language_rules_json`)),
  `navigation_rules_json` text NOT NULL CHECK (json_valid(`navigation_rules_json`)),
  `qualification_stages_json` text NOT NULL CHECK (json_valid(`qualification_stages_json`)),
  `official_source_id` text NOT NULL,
  `effective_from` text NOT NULL,
  `verification_status` text NOT NULL CHECK (`verification_status` IN ('needs_review', 'verified_official', 'archived')),
  `enabled` integer DEFAULT true NOT NULL CHECK (`enabled` IN (0, 1)),
  `created_at` text NOT NULL,
  FOREIGN KEY (`examination_id`) REFERENCES `examinations` (`id`),
  FOREIGN KEY (`official_source_id`) REFERENCES `official_sources` (`id`)
);
CREATE UNIQUE INDEX `examination_patterns_version_unique` ON `examination_patterns` (`examination_id`, `tier_stage`, `version`);

CREATE TABLE `cutoffs` (
  `id` text PRIMARY KEY NOT NULL,
  `examination_id` text NOT NULL,
  `year` integer NOT NULL CHECK (`year` BETWEEN 1950 AND 2200),
  `tier_stage` text NOT NULL,
  `category` text NOT NULL,
  `gender` text,
  `post` text,
  `region` text,
  `score_type` text NOT NULL CHECK (`score_type` IN ('raw', 'normalised')),
  `cutoff_marks` real NOT NULL,
  `vacancy_count` integer CHECK (`vacancy_count` IS NULL OR `vacancy_count` >= 0),
  `official_source_id` text NOT NULL,
  `verification_status` text NOT NULL CHECK (`verification_status` IN ('needs_review', 'verified_official', 'disputed', 'archived')),
  `reviewer_ref` text,
  `verified_at` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`examination_id`) REFERENCES `examinations` (`id`),
  FOREIGN KEY (`official_source_id`) REFERENCES `official_sources` (`id`)
);
CREATE INDEX `cutoffs_lookup_idx` ON `cutoffs` (`examination_id`, `year`, `tier_stage`, `category`);

CREATE TABLE `notes` (
  `id` text PRIMARY KEY NOT NULL,
  `examination_id` text NOT NULL,
  `subject` text NOT NULL,
  `topic` text NOT NULL,
  `title` text NOT NULL,
  `summary_markdown` text NOT NULL,
  `language` text NOT NULL CHECK (`language` IN ('en', 'hi', 'bilingual')),
  `verification_status` text NOT NULL CHECK (`verification_status` IN ('draft', 'needs_review', 'verified_editorial', 'published', 'archived')),
  `reviewer_ref` text,
  `last_updated_at` text NOT NULL,
  `published_at` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`examination_id`) REFERENCES `examinations` (`id`)
);
CREATE INDEX `notes_public_lookup_idx` ON `notes` (`examination_id`, `verification_status`, `subject`, `topic`);

CREATE TABLE `note_citations` (
  `id` text PRIMARY KEY NOT NULL,
  `note_id` text NOT NULL,
  `source_id` text NOT NULL,
  `label` text NOT NULL,
  `source_page` integer CHECK (`source_page` IS NULL OR `source_page` > 0),
  FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`source_id`) REFERENCES `official_sources` (`id`)
);
CREATE INDEX `note_citations_note_idx` ON `note_citations` (`note_id`);

CREATE TABLE `question_reports` (
  `id` text PRIMARY KEY NOT NULL,
  `question_id` text NOT NULL,
  `visitor_number` integer NOT NULL,
  `reason` text NOT NULL,
  `detail` text,
  `status` text DEFAULT 'open' NOT NULL CHECK (`status` IN ('open', 'reviewing', 'resolved', 'dismissed')),
  `created_at` text NOT NULL,
  FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`),
  FOREIGN KEY (`visitor_number`) REFERENCES `anonymous_visitors` (`visitor_number`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX `question_reports_visitor_question_unique` ON `question_reports` (`question_id`, `visitor_number`);

CREATE TRIGGER `question_review_history_no_update`
BEFORE UPDATE ON `question_review_history`
BEGIN
  SELECT RAISE(ABORT, 'review history is immutable');
END;

CREATE TRIGGER `question_review_history_no_delete`
BEFORE DELETE ON `question_review_history`
BEGIN
  SELECT RAISE(ABORT, 'review history is immutable');
END;

CREATE TRIGGER `answer_key_version_no_delete`
BEFORE DELETE ON `answer_key_versions`
BEGIN
  SELECT RAISE(ABORT, 'answer-key versions cannot be deleted');
END;

CREATE TRIGGER `answer_key_version_immutable_fields`
BEFORE UPDATE OF `question_id`, `source_id`, `key_type`, `version_label`, `correct_option_index`, `reviewer_ref`, `effective_at`, `created_at`
ON `answer_key_versions`
BEGIN
  SELECT RAISE(ABORT, 'answer-key provenance is immutable');
END;

CREATE TRIGGER `question_publish_options_gate`
BEFORE UPDATE OF `verification_status` ON `questions`
WHEN NEW.`verification_status` = 'published'
  AND OLD.`verification_status` <> 'published'
  AND (SELECT COUNT(*) FROM `question_options` WHERE `question_id` = NEW.`id`) <> 4
BEGIN
  SELECT RAISE(ABORT, 'published question must have exactly four options');
END;

CREATE TRIGGER `question_publish_official_verification_gate`
BEFORE UPDATE OF `verification_status` ON `questions`
WHEN NEW.`verification_status` = 'published'
  AND OLD.`verification_status` <> 'published'
  AND NEW.`content_origin` = 'official_pyq'
  AND OLD.`verification_status` <> 'verified_official'
BEGIN
  SELECT RAISE(ABORT, 'official PYQ must be verified before publication');
END;

CREATE TRIGGER `question_publish_answer_key_gate`
BEFORE UPDATE OF `verification_status` ON `questions`
WHEN NEW.`verification_status` = 'published'
  AND OLD.`verification_status` <> 'published'
  AND NEW.`content_origin` = 'official_pyq'
  AND NOT EXISTS (
    SELECT 1 FROM `answer_key_versions`
    WHERE `question_id` = NEW.`id` AND `key_type` = 'final' AND `is_current` = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'official PYQ requires a current final answer key');
END;

CREATE TRIGGER `question_publish_editorial_verification_gate`
BEFORE UPDATE OF `verification_status` ON `questions`
WHEN NEW.`verification_status` = 'published'
  AND OLD.`verification_status` <> 'published'
  AND NEW.`content_origin` IN ('editorial', 'ai_generated_practice')
  AND OLD.`verification_status` <> 'verified_editorial'
BEGIN
  SELECT RAISE(ABORT, 'editorial content must be verified before publication');
END;

CREATE TRIGGER `note_publish_verification_gate`
BEFORE UPDATE OF `verification_status` ON `notes`
WHEN NEW.`verification_status` = 'published'
  AND OLD.`verification_status` <> 'published'
  AND OLD.`verification_status` <> 'verified_editorial'
BEGIN
  SELECT RAISE(ABORT, 'note must be editorially verified before publication');
END;

CREATE TRIGGER `note_publish_citation_gate`
BEFORE UPDATE OF `verification_status` ON `notes`
WHEN NEW.`verification_status` = 'published'
  AND OLD.`verification_status` <> 'published'
  AND NOT EXISTS (SELECT 1 FROM `note_citations` WHERE `note_id` = NEW.`id`)
BEGIN
  SELECT RAISE(ABORT, 'published note requires at least one citation');
END;

INSERT INTO `examinations`
(`id`, `slug`, `short_name`, `full_name`, `qualification_level`, `content_status`, `priority`, `enabled`, `created_at`)
VALUES
('exam-ssc-mts', 'ssc-mts', 'SSC MTS', 'Multi-Tasking (Non-Technical) Staff', 'secondary', 'under_verification', 10, 1, '2026-07-30T00:00:00.000Z'),
('exam-ssc-gd', 'ssc-gd', 'SSC GD Constable', 'General Duty Constable', 'secondary', 'under_verification', 20, 1, '2026-07-30T00:00:00.000Z'),
('exam-ssc-chsl', 'ssc-chsl', 'SSC CHSL', 'Combined Higher Secondary Level', 'secondary', 'under_verification', 30, 1, '2026-07-30T00:00:00.000Z'),
('exam-ssc-cgl', 'ssc-cgl', 'SSC CGL', 'Combined Graduate Level', 'graduate', 'under_verification', 40, 1, '2026-07-30T00:00:00.000Z'),
('exam-ssc-cpo', 'ssc-cpo', 'SSC CPO', 'Central Police Organisation', 'graduate', 'under_verification', 50, 1, '2026-07-30T00:00:00.000Z'),
('exam-rrb-ntpc-graduate', 'rrb-ntpc-graduate', 'RRB NTPC Graduate', 'Non-Technical Popular Categories', 'graduate', 'under_verification', 60, 1, '2026-07-30T00:00:00.000Z');

INSERT INTO `source_authorities`
(`id`, `slug`, `name`, `domains_json`, `enabled`, `created_at`)
VALUES
('authority-ssc', 'ssc', 'Staff Selection Commission', '["ssc.gov.in"]', 1, '2026-07-30T00:00:00.000Z'),
('authority-upsc', 'upsc', 'Union Public Service Commission', '["upsc.gov.in","www.upsc.gov.in","upsconline.gov.in"]', 1, '2026-07-30T00:00:00.000Z'),
('authority-rrb', 'rrb', 'Railway Recruitment Boards', '["rrcb.gov.in","www.rrcb.gov.in","rrbcdg.gov.in","www.rrbcdg.gov.in"]', 1, '2026-07-30T00:00:00.000Z'),
('authority-nta', 'nta', 'National Testing Agency', '["nta.ac.in","www.nta.ac.in","nta.nic.in","www.nta.nic.in"]', 1, '2026-07-30T00:00:00.000Z'),
('authority-ibps', 'ibps', 'Institute of Banking Personnel Selection', '["ibps.in","www.ibps.in"]', 1, '2026-07-30T00:00:00.000Z');

PRAGMA defer_foreign_keys = OFF;
