DROP INDEX IF EXISTS `generation_runs_state_lease_idx`;
ALTER TABLE `generation_runs` DROP COLUMN `resume_count`;
ALTER TABLE `generation_runs` DROP COLUMN `state_updated_at`;
ALTER TABLE `generation_runs` DROP COLUMN `failure_recoverable`;
ALTER TABLE `generation_runs` DROP COLUMN `failed_stage`;
ALTER TABLE `generation_runs` DROP COLUMN `state`;
DROP TRIGGER IF EXISTS `attempt_no_reopen`;
CREATE TRIGGER `attempt_no_reopen`
BEFORE UPDATE OF `status` ON `attempts`
WHEN OLD.`status` IN ('submitted', 'timed_out', 'abandoned') AND NEW.`status` <> OLD.`status`
BEGIN
  SELECT RAISE(ABORT, 'terminal attempt cannot be reopened');
END;
