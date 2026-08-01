-- Safe recovery for unscored AI attempts that retained a valid candidate snapshot.
-- Completed attempts, submitted attempts, scores and answer results are never changed.
UPDATE `generation_runs`
SET `state` = 'retryable',
    `status` = 'running',
    `failed_stage` = COALESCE(`retry_stage`, CASE WHEN `stage` = 'verifying' THEN 'verification' ELSE 'generation' END),
    `failure_recoverable` = 1,
    `completed_at` = NULL,
    `lock_stage` = NULL,
    `lock_token` = NULL,
    `lock_expires_at` = NULL,
    `state_updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ','now')
WHERE `attempt_id` IN (
  SELECT a.`id`
  FROM `attempts` a
  WHERE a.`generation_status` = 'failed'
    AND a.`status` = 'abandoned'
    AND a.`score_json` IS NULL
    AND a.`submitted_at` IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM `attempt_question_results` r WHERE r.`attempt_id` = a.`id`
    )
)
AND `candidate_json` IS NOT NULL
AND json_valid(`candidate_json`)
AND `status` IN ('failed','exhausted');
