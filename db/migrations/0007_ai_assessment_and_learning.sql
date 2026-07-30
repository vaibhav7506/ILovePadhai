ALTER TABLE `attempts` ADD COLUMN `generation_status` text NOT NULL DEFAULT 'ready'
  CHECK (`generation_status` IN ('pending','preparing','generating','deduplicating','verifying','ready','failed'));
ALTER TABLE `attempts` ADD COLUMN `generation_error` text;

CREATE TABLE `prompt_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `examination_id` text NOT NULL,
  `version` text NOT NULL,
  `template_hash` text NOT NULL,
  `active` integer NOT NULL DEFAULT 1 CHECK (`active` IN (0,1)),
  `created_at` text NOT NULL,
  FOREIGN KEY (`examination_id`) REFERENCES `examinations` (`id`)
);
CREATE UNIQUE INDEX `prompt_versions_exam_version_unique` ON `prompt_versions` (`examination_id`,`version`);

CREATE TABLE `generation_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `attempt_id` text NOT NULL UNIQUE,
  `visitor_number` integer NOT NULL,
  `request_fingerprint` text NOT NULL,
  `active_key` text UNIQUE,
  `stage` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('pending','running','completed','failed','exhausted')),
  `requested_count` integer NOT NULL,
  `accepted_count` integer NOT NULL DEFAULT 0,
  `rejected_count` integer NOT NULL DEFAULT 0,
  `input_tokens` integer NOT NULL DEFAULT 0,
  `output_tokens` integer NOT NULL DEFAULT 0,
  `estimated_cost_usd` real NOT NULL DEFAULT 0,
  `error_summary` text,
  `started_at` text,
  `completed_at` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`attempt_id`) REFERENCES `attempts` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`visitor_number`) REFERENCES `anonymous_visitors` (`visitor_number`) ON DELETE CASCADE
);
CREATE INDEX `generation_runs_visitor_day_idx` ON `generation_runs` (`visitor_number`,`created_at`);

CREATE TABLE `generated_questions` (
  `question_id` text PRIMARY KEY NOT NULL,
  `generation_run_id` text NOT NULL,
  `prompt_version` text NOT NULL,
  `explanation` text NOT NULL,
  `verification_status` text NOT NULL CHECK (`verification_status` IN ('verified','rejected')),
  `verification_confidence` real NOT NULL,
  `verification_reason` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`generation_run_id`) REFERENCES `generation_runs` (`id`) ON DELETE CASCADE
);

CREATE TABLE `question_fingerprints` (
  `question_id` text PRIMARY KEY NOT NULL,
  `exact_sha256` text NOT NULL UNIQUE,
  `stem_sha256` text NOT NULL,
  `option_order_independent_sha256` text NOT NULL UNIQUE,
  `normalised_tokens` text NOT NULL,
  `concept_key` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`) ON DELETE CASCADE
);
CREATE INDEX `question_fingerprints_concept_idx` ON `question_fingerprints` (`concept_key`,`created_at`);

CREATE TABLE `visitor_question_history` (
  `visitor_number` integer NOT NULL,
  `question_id` text NOT NULL,
  `exact_sha256` text NOT NULL,
  `shown_at` text NOT NULL,
  `mode` text NOT NULL,
  PRIMARY KEY (`visitor_number`,`question_id`),
  FOREIGN KEY (`visitor_number`) REFERENCES `anonymous_visitors` (`visitor_number`) ON DELETE CASCADE,
  FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`) ON DELETE CASCADE
);
CREATE INDEX `visitor_question_history_exact_idx` ON `visitor_question_history` (`visitor_number`,`exact_sha256`);

CREATE TABLE `study_task_learning` (
  `plan_item_id` text PRIMARY KEY NOT NULL,
  `state` text NOT NULL DEFAULT 'not_started' CHECK (`state` IN ('not_started','reading','check_required','retry_required','completed','skipped')),
  `engaged_seconds` integer NOT NULL DEFAULT 0,
  `max_scroll_percent` integer NOT NULL DEFAULT 0,
  `visible_seconds` integer NOT NULL DEFAULT 0,
  `sections_opened` integer NOT NULL DEFAULT 0,
  `examples_interacted` integer NOT NULL DEFAULT 0,
  `check_attempts` integer NOT NULL DEFAULT 0,
  `correct_answers` integer NOT NULL DEFAULT 0,
  `total_answers` integer NOT NULL DEFAULT 0,
  `completed_at` text,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`plan_item_id`) REFERENCES `study_plan_items` (`id`) ON DELETE CASCADE
);

CREATE TABLE `study_comprehension_attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `plan_item_id` text NOT NULL,
  `attempt_number` integer NOT NULL,
  `question_ids_json` text NOT NULL CHECK (json_valid(`question_ids_json`)),
  `answers_json` text CHECK (`answers_json` IS NULL OR json_valid(`answers_json`)),
  `score_percent` real,
  `passed` integer CHECK (`passed` IS NULL OR `passed` IN (0,1)),
  `created_at` text NOT NULL,
  `submitted_at` text,
  FOREIGN KEY (`plan_item_id`) REFERENCES `study_plan_items` (`id`) ON DELETE CASCADE
);
CREATE UNIQUE INDEX `study_check_number_unique` ON `study_comprehension_attempts` (`plan_item_id`,`attempt_number`);

CREATE TABLE `study_revisions` (
  `id` text PRIMARY KEY NOT NULL,
  `plan_item_id` text NOT NULL,
  `due_at` text NOT NULL,
  `interval_days` integer NOT NULL CHECK (`interval_days` IN (1,3,7,15)),
  `status` text NOT NULL DEFAULT 'scheduled' CHECK (`status` IN ('scheduled','completed','skipped')),
  FOREIGN KEY (`plan_item_id`) REFERENCES `study_plan_items` (`id`) ON DELETE CASCADE
);
CREATE INDEX `study_revisions_due_idx` ON `study_revisions` (`status`,`due_at`);

INSERT INTO `prompt_versions` (`id`,`examination_id`,`version`,`template_hash`,`active`,`created_at`)
SELECT 'prompt-' || `slug`, `id`,
  CASE `slug`
    WHEN 'ssc-mts' THEN 'ssc-mts-v1' WHEN 'ssc-gd' THEN 'ssc-gd-v1'
    WHEN 'ssc-chsl' THEN 'ssc-chsl-v1' WHEN 'ssc-cgl' THEN 'ssc-cgl-v1'
    WHEN 'ssc-cpo' THEN 'ssc-cpo-v1' ELSE 'rrb-ntpc-graduate-v1' END,
  lower(hex(randomblob(32))), 1, '2026-07-30T00:00:00.000Z'
FROM `examinations`;

INSERT OR IGNORE INTO `source_authorities`
  (`id`,`slug`,`name`,`domains_json`,`enabled`,`created_at`)
VALUES
  ('authority-examforge-ai','examforge-ai','ExamForge AI practice engine','[]',1,'2026-07-30T00:00:00.000Z');
INSERT OR IGNORE INTO `official_sources`
  (`id`,`authority_id`,`examination_id`,`content_type`,`source_url`,`copyright_status`,`enabled`,`created_at`)
VALUES
  ('source-examforge-ai','authority-examforge-ai',NULL,'ai_practice','https://examforge.local/ai-practice','original_practice_content',1,'2026-07-30T00:00:00.000Z');
INSERT OR IGNORE INTO `source_documents`
  (`id`,`source_id`,`sha256`,`file_name`,`mime_type`,`byte_size`,`reproduction_status`,`retrieved_at`,`extraction_status`,`created_at`)
VALUES
  ('document-examforge-ai','source-examforge-ai','0000000000000000000000000000000000000000000000000000000000000007','generated-practice.json','application/json',1,'original','2026-07-30T00:00:00.000Z','complete','2026-07-30T00:00:00.000Z');
