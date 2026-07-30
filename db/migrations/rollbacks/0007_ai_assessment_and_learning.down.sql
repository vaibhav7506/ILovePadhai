DROP TABLE IF EXISTS `study_revisions`;
DROP TABLE IF EXISTS `study_comprehension_attempts`;
DROP TABLE IF EXISTS `study_task_learning`;
DROP TABLE IF EXISTS `visitor_question_history`;
DROP TABLE IF EXISTS `question_fingerprints`;
DROP TABLE IF EXISTS `generated_questions`;
DROP TABLE IF EXISTS `generation_runs`;
DROP TABLE IF EXISTS `prompt_versions`;
-- SQLite cannot drop the additive attempts columns without rebuilding the table.
