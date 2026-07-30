ALTER TABLE `attempts` ADD COLUMN `comparison_key` text;
ALTER TABLE `attempts` ADD COLUMN `integrity_status` text NOT NULL DEFAULT 'legitimate'
  CHECK (`integrity_status` IN ('legitimate', 'flagged', 'excluded'));
ALTER TABLE `attempts` ADD COLUMN `integrity_flags_json` text NOT NULL DEFAULT '[]'
  CHECK (json_valid(`integrity_flags_json`));
ALTER TABLE `attempts` ADD COLUMN `answer_change_count` integer NOT NULL DEFAULT 0
  CHECK (`answer_change_count` >= 0);
ALTER TABLE `attempts` ADD COLUMN `post_name` text;
ALTER TABLE `attempts` ADD COLUMN `stage_name` text;

ALTER TABLE `attempt_questions` ADD COLUMN `subject` text NOT NULL DEFAULT 'General';
ALTER TABLE `attempt_questions` ADD COLUMN `difficulty` text NOT NULL DEFAULT 'unrated';
ALTER TABLE `attempt_responses` ADD COLUMN `time_spent_seconds` integer NOT NULL DEFAULT 0
  CHECK (`time_spent_seconds` >= 0);

CREATE INDEX `attempts_comparable_idx`
  ON `attempts` (`comparison_key`, `integrity_status`, `status`, `submitted_at`);

CREATE TABLE `leaderboard_profiles` (
  `visitor_number` integer PRIMARY KEY NOT NULL,
  `nickname` text NOT NULL,
  `is_visible` integer NOT NULL DEFAULT false CHECK (`is_visible` IN (0, 1)),
  `updated_at` text NOT NULL,
  FOREIGN KEY (`visitor_number`) REFERENCES `anonymous_visitors` (`visitor_number`) ON DELETE CASCADE
);

CREATE TABLE `leaderboard_entries` (
  `attempt_id` text PRIMARY KEY NOT NULL,
  `visitor_number` integer NOT NULL,
  `comparison_key` text NOT NULL,
  `attempt_ordinal` integer NOT NULL CHECK (`attempt_ordinal` > 0),
  `score` real NOT NULL,
  `max_marks` real NOT NULL,
  `accuracy` real NOT NULL,
  `completion_time_seconds` integer NOT NULL,
  `submitted_at` text NOT NULL,
  FOREIGN KEY (`attempt_id`) REFERENCES `attempts` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`visitor_number`) REFERENCES `anonymous_visitors` (`visitor_number`) ON DELETE CASCADE
);
CREATE INDEX `leaderboard_entries_comparable_idx`
  ON `leaderboard_entries` (`comparison_key`, `score` DESC, `accuracy` DESC, `completion_time_seconds`);
CREATE UNIQUE INDEX `leaderboard_entries_ordinal_unique`
  ON `leaderboard_entries` (`visitor_number`, `comparison_key`, `attempt_ordinal`);

CREATE TABLE `attempt_integrity_events` (
  `id` text PRIMARY KEY NOT NULL,
  `attempt_id` text NOT NULL,
  `code` text NOT NULL,
  `severity` text NOT NULL CHECK (`severity` IN ('review', 'exclude')),
  `detail` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`attempt_id`) REFERENCES `attempts` (`id`) ON DELETE CASCADE
);

CREATE TRIGGER `leaderboard_entries_no_update`
BEFORE UPDATE ON `leaderboard_entries`
BEGIN
  SELECT RAISE(ABORT, 'leaderboard entry snapshots are immutable');
END;

CREATE TRIGGER `leaderboard_entries_no_delete`
BEFORE DELETE ON `leaderboard_entries`
BEGIN
  SELECT RAISE(ABORT, 'leaderboard entry snapshots are immutable');
END;

CREATE TRIGGER `attempt_integrity_events_no_update`
BEFORE UPDATE ON `attempt_integrity_events`
BEGIN
  SELECT RAISE(ABORT, 'integrity events are immutable');
END;
