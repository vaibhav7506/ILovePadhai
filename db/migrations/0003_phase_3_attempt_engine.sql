CREATE TABLE `attempts` (
  `id` text PRIMARY KEY NOT NULL,
  `visitor_number` integer NOT NULL,
  `examination_id` text NOT NULL,
  `pattern_id` text,
  `mode` text NOT NULL CHECK (`mode` IN ('standard', 'custom', 'previous_year', 'diagnostic')),
  `tier_stage` text NOT NULL,
  `nickname` text,
  `category` text,
  `region` text,
  `selection_json` text NOT NULL CHECK (json_valid(`selection_json`)),
  `status` text DEFAULT 'active' NOT NULL CHECK (`status` IN ('active', 'submitted', 'timed_out', 'abandoned')),
  `question_count` integer NOT NULL CHECK (`question_count` > 0),
  `duration_seconds` integer NOT NULL CHECK (`duration_seconds` > 0),
  `started_at` text NOT NULL,
  `expires_at` text NOT NULL,
  `submitted_at` text,
  `submission_reason` text CHECK (`submission_reason` IS NULL OR `submission_reason` IN ('manual', 'timeout')),
  `score_json` text CHECK (`score_json` IS NULL OR json_valid(`score_json`)),
  `created_at` text NOT NULL,
  FOREIGN KEY (`visitor_number`) REFERENCES `anonymous_visitors` (`visitor_number`) ON DELETE CASCADE,
  FOREIGN KEY (`examination_id`) REFERENCES `examinations` (`id`),
  FOREIGN KEY (`pattern_id`) REFERENCES `examination_patterns` (`id`)
);
CREATE INDEX `attempts_visitor_status_idx` ON `attempts` (`visitor_number`, `status`, `created_at`);

CREATE TABLE `attempt_questions` (
  `attempt_id` text NOT NULL,
  `question_id` text NOT NULL,
  `position` integer NOT NULL CHECK (`position` > 0),
  `section` text NOT NULL,
  `topic` text NOT NULL,
  `positive_marks` real NOT NULL CHECK (`positive_marks` >= 0),
  `negative_marks` real NOT NULL CHECK (`negative_marks` >= 0),
  PRIMARY KEY (`attempt_id`, `position`),
  FOREIGN KEY (`attempt_id`) REFERENCES `attempts` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`)
);
CREATE UNIQUE INDEX `attempt_questions_attempt_question_unique`
  ON `attempt_questions` (`attempt_id`, `question_id`);

CREATE TABLE `attempt_responses` (
  `attempt_id` text NOT NULL,
  `question_id` text NOT NULL,
  `selected_option_index` integer CHECK (`selected_option_index` IS NULL OR `selected_option_index` BETWEEN 0 AND 3),
  `marked_for_review` integer DEFAULT false NOT NULL CHECK (`marked_for_review` IN (0, 1)),
  `visited` integer DEFAULT false NOT NULL CHECK (`visited` IN (0, 1)),
  `client_elapsed_seconds` integer DEFAULT 0 NOT NULL CHECK (`client_elapsed_seconds` >= 0),
  `client_revision` integer DEFAULT 0 NOT NULL CHECK (`client_revision` >= 0),
  `mutation_id` text,
  `server_updated_at` text,
  PRIMARY KEY (`attempt_id`, `question_id`),
  FOREIGN KEY (`attempt_id`) REFERENCES `attempts` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`)
);

CREATE TABLE `attempt_question_results` (
  `attempt_id` text NOT NULL,
  `question_id` text NOT NULL,
  `selected_option_index` integer,
  `correct_option_index` integer NOT NULL CHECK (`correct_option_index` BETWEEN 0 AND 3),
  `outcome` text NOT NULL CHECK (`outcome` IN ('correct', 'incorrect', 'unattempted')),
  `score_awarded` real NOT NULL,
  `created_at` text NOT NULL,
  PRIMARY KEY (`attempt_id`, `question_id`),
  FOREIGN KEY (`attempt_id`) REFERENCES `attempts` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`)
);

CREATE TRIGGER `attempt_no_reopen`
BEFORE UPDATE OF `status` ON `attempts`
WHEN OLD.`status` IN ('submitted', 'timed_out', 'abandoned') AND NEW.`status` <> OLD.`status`
BEGIN
  SELECT RAISE(ABORT, 'terminal attempt cannot be reopened');
END;

CREATE TRIGGER `attempt_results_no_update`
BEFORE UPDATE ON `attempt_question_results`
BEGIN
  SELECT RAISE(ABORT, 'scored results are immutable');
END;

CREATE TRIGGER `attempt_results_no_delete`
BEFORE DELETE ON `attempt_question_results`
BEGIN
  SELECT RAISE(ABORT, 'scored results are immutable');
END;
