DROP TRIGGER IF EXISTS `attempt_integrity_events_no_update`;
DROP TRIGGER IF EXISTS `leaderboard_entries_no_delete`;
DROP TRIGGER IF EXISTS `leaderboard_entries_no_update`;
DROP TABLE IF EXISTS `attempt_integrity_events`;
DROP TABLE IF EXISTS `leaderboard_entries`;
DROP TABLE IF EXISTS `leaderboard_profiles`;
DROP INDEX IF EXISTS `attempts_comparable_idx`;
-- SQLite does not support a safe cross-version column rollback. Restore a pre-Phase-4 backup
-- after dropping the Phase-4 tables if a complete rollback is required.
