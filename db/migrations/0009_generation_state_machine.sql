ALTER TABLE `generation_runs` ADD COLUMN `state` text NOT NULL DEFAULT 'pending'
  CHECK (`state` IN ('pending','generating','verification_pending','verifying','rate_limited','retryable','ready','completed','cancelled','expired','invalid'));
ALTER TABLE `generation_runs` ADD COLUMN `failed_stage` text
  CHECK (`failed_stage` IS NULL OR `failed_stage` IN ('generation','verification'));
ALTER TABLE `generation_runs` ADD COLUMN `failure_recoverable` integer NOT NULL DEFAULT 1
  CHECK (`failure_recoverable` IN (0,1));
ALTER TABLE `generation_runs` ADD COLUMN `state_updated_at` text;
ALTER TABLE `generation_runs` ADD COLUMN `resume_count` integer NOT NULL DEFAULT 0
  CHECK (`resume_count` >= 0);

UPDATE `generation_runs`
SET `state` = CASE
      WHEN `status` = 'completed' OR `stage` = 'ready' THEN 'ready'
      WHEN `stage` = 'rate_limited' THEN 'rate_limited'
      WHEN `stage` = 'retry_failed' THEN 'retryable'
      WHEN `status` IN ('failed','exhausted') AND `candidate_json` IS NOT NULL THEN 'retryable'
      WHEN `status` IN ('failed','exhausted') THEN 'invalid'
      WHEN `stage` = 'verifying' THEN 'verification_pending'
      WHEN `stage` IN ('generating','deduplicating') THEN 'generating'
      ELSE 'pending'
    END,
    `failed_stage` = CASE
      WHEN `retry_stage` IS NOT NULL THEN `retry_stage`
      WHEN `stage` = 'verifying' THEN 'verification'
      ELSE 'generation'
    END,
    `failure_recoverable` = CASE
      WHEN `status` IN ('failed','exhausted') AND `candidate_json` IS NULL THEN 0
      ELSE 1
    END,
    `state_updated_at` = COALESCE(`completed_at`,`started_at`,`created_at`);

CREATE INDEX `generation_runs_state_lease_idx`
  ON `generation_runs` (`state`,`lock_expires_at`);

DROP TRIGGER IF EXISTS `attempt_no_reopen`;
CREATE TRIGGER `attempt_no_reopen`
BEFORE UPDATE OF `status` ON `attempts`
WHEN OLD.`status` IN ('submitted', 'timed_out', 'abandoned')
  AND NEW.`status` <> OLD.`status`
  AND NOT (
    OLD.`status` = 'abandoned'
    AND NEW.`status` = 'active'
    AND OLD.`generation_status` = 'failed'
    AND NEW.`generation_status` = 'ready'
    AND OLD.`score_json` IS NULL
    AND OLD.`submitted_at` IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM `attempt_question_results` WHERE `attempt_id` = OLD.`id`
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'terminal attempt cannot be reopened');
END;
