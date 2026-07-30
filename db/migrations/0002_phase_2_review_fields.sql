ALTER TABLE `questions` ADD COLUMN `explanation_markdown` text;
ALTER TABLE `notes` ADD COLUMN `related_topics_json` text DEFAULT '[]' NOT NULL
  CHECK (json_valid(`related_topics_json`));

CREATE TABLE `note_related_questions` (
  `note_id` text NOT NULL,
  `question_id` text NOT NULL,
  PRIMARY KEY (`note_id`, `question_id`),
  FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE,
  FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`)
);

CREATE TRIGGER `question_publication_requires_explanation_field`
BEFORE UPDATE OF `verification_status` ON `questions`
WHEN NEW.`verification_status` = 'published'
  AND NEW.`explanation_markdown` IS NOT NULL
  AND length(trim(NEW.`explanation_markdown`)) < 10
BEGIN
  SELECT RAISE(ABORT, 'question explanation must be empty or substantive');
END;
