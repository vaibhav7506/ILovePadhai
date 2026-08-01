CREATE TABLE `ai_provider_gate` (
  `id` integer PRIMARY KEY CHECK (`id` = 1),
  `lock_token` text,
  `lock_attempt_id` text,
  `lock_model` text,
  `lock_stage` text CHECK (`lock_stage` IS NULL OR `lock_stage` IN ('generation','verification')),
  `lock_expires_at` text,
  `next_allowed_at` text NOT NULL,
  `updated_at` text NOT NULL
);

INSERT INTO `ai_provider_gate` (`id`,`next_allowed_at`,`updated_at`)
VALUES (1,'1970-01-01T00:00:00.000Z','1970-01-01T00:00:00.000Z');

CREATE TABLE `ai_provider_model_cooldowns` (
  `model` text PRIMARY KEY,
  `cooldown_until` text NOT NULL,
  `provider_status` integer NOT NULL,
  `updated_at` text NOT NULL
);

CREATE INDEX `ai_provider_model_cooldowns_until_idx`
  ON `ai_provider_model_cooldowns` (`cooldown_until`);

CREATE TABLE `attempt_generation_hashes` (
  `id` text PRIMARY KEY,
  `attempt_id` text NOT NULL REFERENCES `attempts`(`id`) ON DELETE CASCADE,
  `normalized_sha256` text NOT NULL,
  `created_at` text NOT NULL
);

CREATE UNIQUE INDEX `attempt_generation_hashes_identity_unique`
  ON `attempt_generation_hashes` (`attempt_id`,`normalized_sha256`);

CREATE INDEX `attempt_generation_hashes_hash_idx`
  ON `attempt_generation_hashes` (`normalized_sha256`);
