PRAGMA foreign_keys = ON;

CREATE TABLE `anonymous_visitors` (
  `visitor_number` integer PRIMARY KEY NOT NULL,
  `visitor_uuid` text NOT NULL,
  `first_seen_at` text NOT NULL,
  `last_seen_at` text NOT NULL,
  `visit_count` integer DEFAULT 1 NOT NULL,
  `device_category` text DEFAULT 'unknown' NOT NULL
);
CREATE UNIQUE INDEX `anonymous_visitors_uuid_unique` ON `anonymous_visitors` (`visitor_uuid`);
CREATE INDEX `anonymous_visitors_first_seen_idx` ON `anonymous_visitors` (`first_seen_at`);

CREATE TABLE `visitor_sessions` (
  `session_uuid` text PRIMARY KEY NOT NULL,
  `visitor_number` integer NOT NULL,
  `started_at` text NOT NULL,
  `last_activity_at` text NOT NULL,
  `landing_path` text NOT NULL,
  `referrer_category` text DEFAULT 'unknown' NOT NULL,
  `device_category` text DEFAULT 'unknown' NOT NULL,
  FOREIGN KEY (`visitor_number`) REFERENCES `anonymous_visitors`(`visitor_number`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `visitor_sessions_visitor_idx` ON `visitor_sessions` (`visitor_number`);

CREATE TABLE `page_events` (
  `event_uuid` text PRIMARY KEY NOT NULL,
  `visitor_number` integer NOT NULL,
  `session_uuid` text NOT NULL,
  `event_type` text NOT NULL,
  `path` text NOT NULL,
  `examination_slug` text,
  `occurred_at` text NOT NULL,
  FOREIGN KEY (`visitor_number`) REFERENCES `anonymous_visitors`(`visitor_number`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`session_uuid`) REFERENCES `visitor_sessions`(`session_uuid`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `page_events_session_idx` ON `page_events` (`session_uuid`);
CREATE INDEX `page_events_type_date_idx` ON `page_events` (`event_type`, `occurred_at`);

CREATE TABLE `consent_preferences` (
  `visitor_number` integer PRIMARY KEY NOT NULL,
  `anonymous_analytics` integer DEFAULT true NOT NULL,
  `updated_at` text NOT NULL,
  FOREIGN KEY (`visitor_number`) REFERENCES `anonymous_visitors`(`visitor_number`) ON UPDATE no action ON DELETE cascade
);
