DROP INDEX IF EXISTS `generation_runs_cooldown_idx`;
ALTER TABLE `generation_runs` DROP COLUMN `lock_expires_at`;
ALTER TABLE `generation_runs` DROP COLUMN `lock_token`;
ALTER TABLE `generation_runs` DROP COLUMN `lock_stage`;
ALTER TABLE `generation_runs` DROP COLUMN `auto_retry_used`;
ALTER TABLE `generation_runs` DROP COLUMN `retry_stage`;
ALTER TABLE `generation_runs` DROP COLUMN `cooldown_until`;
ALTER TABLE `generation_runs` DROP COLUMN `candidate_json`;
