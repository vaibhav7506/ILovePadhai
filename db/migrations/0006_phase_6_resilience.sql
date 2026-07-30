CREATE INDEX `page_events_operational_idx`
  ON `page_events` (`event_type`, `occurred_at`);
CREATE INDEX `question_reports_queue_idx`
  ON `question_reports` (`status`, `created_at`);
CREATE INDEX `ingestion_runs_status_idx`
  ON `ingestion_runs` (`status`, `started_at`);
CREATE INDEX `questions_offline_pack_idx`
  ON `questions` (`examination_id`, `verification_status`, `subject`, `published_at`);
CREATE INDEX `notes_offline_pack_idx`
  ON `notes` (`verification_status`, `published_at`);
