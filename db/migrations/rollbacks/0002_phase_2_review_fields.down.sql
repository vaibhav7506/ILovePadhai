DROP TRIGGER IF EXISTS `question_publication_requires_explanation_field`;
DROP TABLE IF EXISTS `note_related_questions`;
-- SQLite cannot drop the added columns safely without rebuilding their parent tables.
