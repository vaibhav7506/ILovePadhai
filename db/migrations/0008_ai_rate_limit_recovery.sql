ALTER TABLE `generation_runs` ADD COLUMN `candidate_json` text
  CHECK (`candidate_json` IS NULL OR json_valid(`candidate_json`));
ALTER TABLE `generation_runs` ADD COLUMN `cooldown_until` text;
ALTER TABLE `generation_runs` ADD COLUMN `retry_stage` text
  CHECK (`retry_stage` IS NULL OR `retry_stage` IN ('generation','verification'));
ALTER TABLE `generation_runs` ADD COLUMN `auto_retry_used` integer NOT NULL DEFAULT 0
  CHECK (`auto_retry_used` IN (0,1));
ALTER TABLE `generation_runs` ADD COLUMN `lock_stage` text;
ALTER TABLE `generation_runs` ADD COLUMN `lock_token` text;
ALTER TABLE `generation_runs` ADD COLUMN `lock_expires_at` text;

CREATE INDEX `generation_runs_cooldown_idx`
  ON `generation_runs` (`stage`,`cooldown_until`);
