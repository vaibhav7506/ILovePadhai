CREATE TABLE `study_profiles` (
  `visitor_number` integer PRIMARY KEY NOT NULL,
  `target_examination_id` text,
  `expected_exam_date` text,
  `daily_minutes` integer NOT NULL DEFAULT 60 CHECK (`daily_minutes` BETWEEN 15 AND 720),
  `plan_paused` integer NOT NULL DEFAULT false CHECK (`plan_paused` IN (0, 1)),
  `current_streak` integer NOT NULL DEFAULT 0 CHECK (`current_streak` >= 0),
  `last_study_date` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`visitor_number`) REFERENCES `anonymous_visitors` (`visitor_number`) ON DELETE CASCADE,
  FOREIGN KEY (`target_examination_id`) REFERENCES `examinations` (`id`)
);

CREATE TABLE `topic_mastery` (
  `visitor_number` integer NOT NULL,
  `examination_id` text NOT NULL,
  `subject` text NOT NULL,
  `topic` text NOT NULL,
  `questions_seen` integer NOT NULL DEFAULT 0,
  `correct_count` integer NOT NULL DEFAULT 0,
  `incorrect_count` integer NOT NULL DEFAULT 0,
  `skipped_count` integer NOT NULL DEFAULT 0,
  `total_time_seconds` integer NOT NULL DEFAULT 0,
  `mastery_score` real NOT NULL DEFAULT 0 CHECK (`mastery_score` BETWEEN 0 AND 100),
  `last_practised_at` text NOT NULL,
  PRIMARY KEY (`visitor_number`, `examination_id`, `subject`, `topic`),
  FOREIGN KEY (`visitor_number`) REFERENCES `anonymous_visitors` (`visitor_number`) ON DELETE CASCADE,
  FOREIGN KEY (`examination_id`) REFERENCES `examinations` (`id`)
);
CREATE INDEX `topic_mastery_weak_idx`
  ON `topic_mastery` (`visitor_number`, `examination_id`, `mastery_score`, `last_practised_at`);

CREATE TABLE `mistake_notebook` (
  `visitor_number` integer NOT NULL,
  `question_id` text NOT NULL,
  `attempt_id` text NOT NULL,
  `source_outcome` text NOT NULL CHECK (`source_outcome` IN ('incorrect', 'unattempted', 'marked', 'changed_wrong', 'bookmarked')),
  `mistake_reason` text CHECK (`mistake_reason` IS NULL OR `mistake_reason` IN (
    'concept_not_understood', 'formula_forgotten', 'calculation_mistake',
    'guessed', 'read_incorrectly', 'time_pressure'
  )),
  `revision_status` text NOT NULL DEFAULT 'due' CHECK (`revision_status` IN ('due', 'scheduled', 'mastered')),
  `confidence` integer CHECK (`confidence` IS NULL OR `confidence` BETWEEN 1 AND 5),
  `interval_days` integer NOT NULL DEFAULT 1 CHECK (`interval_days` >= 1),
  `review_count` integer NOT NULL DEFAULT 0 CHECK (`review_count` >= 0),
  `next_review_at` text NOT NULL,
  `last_reviewed_at` text,
  `bookmarked` integer NOT NULL DEFAULT false CHECK (`bookmarked` IN (0, 1)),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`visitor_number`, `question_id`),
  FOREIGN KEY (`visitor_number`) REFERENCES `anonymous_visitors` (`visitor_number`) ON DELETE CASCADE,
  FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`),
  FOREIGN KEY (`attempt_id`) REFERENCES `attempts` (`id`) ON DELETE CASCADE
);
CREATE INDEX `mistake_notebook_revision_idx`
  ON `mistake_notebook` (`visitor_number`, `revision_status`, `next_review_at`);

CREATE TABLE `study_plan_items` (
  `id` text PRIMARY KEY NOT NULL,
  `visitor_number` integer NOT NULL,
  `plan_date` text NOT NULL,
  `item_type` text NOT NULL CHECK (`item_type` IN ('adaptive_practice', 'revision', 'mock', 'notes')),
  `subject` text,
  `topic` text,
  `minutes` integer NOT NULL CHECK (`minutes` BETWEEN 5 AND 240),
  `rationale` text NOT NULL,
  `status` text NOT NULL DEFAULT 'planned' CHECK (`status` IN ('planned', 'completed', 'skipped')),
  `completed_at` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`visitor_number`) REFERENCES `anonymous_visitors` (`visitor_number`) ON DELETE CASCADE
);
CREATE INDEX `study_plan_items_day_idx`
  ON `study_plan_items` (`visitor_number`, `plan_date`, `status`);

CREATE TABLE `current_affairs` (
  `id` text PRIMARY KEY NOT NULL,
  `headline` text NOT NULL,
  `summary` text NOT NULL,
  `topic` text NOT NULL,
  `examination_relevance_json` text NOT NULL CHECK (json_valid(`examination_relevance_json`)),
  `language` text NOT NULL CHECK (`language` IN ('en', 'hi', 'bilingual')),
  `source_url` text NOT NULL,
  `source_title` text NOT NULL,
  `published_on` text NOT NULL,
  `verification_status` text NOT NULL CHECK (`verification_status` IN ('needs_review', 'verified_editorial', 'published', 'archived')),
  `verified_at` text,
  `created_at` text NOT NULL
);
CREATE INDEX `current_affairs_public_idx`
  ON `current_affairs` (`verification_status`, `published_on`, `topic`);

CREATE TABLE `exam_calendar_events` (
  `id` text PRIMARY KEY NOT NULL,
  `examination_id` text NOT NULL,
  `event_type` text NOT NULL CHECK (`event_type` IN (
    'application_open', 'application_close', 'correction_window', 'admit_card',
    'exam', 'tentative_key', 'final_key', 'result', 'pattern_change', 'syllabus_change'
  )),
  `title` text NOT NULL,
  `starts_on` text NOT NULL,
  `ends_on` text,
  `source_url` text NOT NULL,
  `verification_status` text NOT NULL CHECK (`verification_status` IN ('needs_review', 'verified_official', 'archived')),
  `verified_at` text,
  `created_at` text NOT NULL,
  FOREIGN KEY (`examination_id`) REFERENCES `examinations` (`id`)
);
CREATE INDEX `exam_calendar_public_idx`
  ON `exam_calendar_events` (`verification_status`, `starts_on`, `examination_id`);

CREATE TABLE `ai_usage_logs` (
  `id` text PRIMARY KEY NOT NULL,
  `visitor_number` integer,
  `feature` text NOT NULL,
  `model` text,
  `status` text NOT NULL CHECK (`status` IN ('served', 'fallback', 'blocked', 'failed')),
  `input_tokens` integer,
  `output_tokens` integer,
  `created_at` text NOT NULL,
  FOREIGN KEY (`visitor_number`) REFERENCES `anonymous_visitors` (`visitor_number`) ON DELETE SET NULL
);
CREATE INDEX `ai_usage_logs_day_idx` ON `ai_usage_logs` (`created_at`, `feature`, `status`);

CREATE TRIGGER `ai_usage_logs_no_prompt_update`
BEFORE UPDATE ON `ai_usage_logs`
BEGIN
  SELECT RAISE(ABORT, 'AI usage logs are immutable');
END;
