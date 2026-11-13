CREATE TABLE `agent_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`attendee_id` text NOT NULL,
	`label` text NOT NULL,
	`prefix` text NOT NULL,
	`secret_sha256` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text,
	`revoked_at` text,
	FOREIGN KEY (`attendee_id`) REFERENCES `attendees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_tokens_secret_sha256_unique` ON `agent_tokens` (`secret_sha256`);--> statement-breakpoint
CREATE INDEX `agent_tokens_attendee_id` ON `agent_tokens` (`attendee_id`);--> statement-breakpoint
CREATE TABLE `attendees` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`display_name` text NOT NULL,
	`headline` text,
	`avatar_url` text,
	`linkedin_profile_url` text,
	`visibility` text DEFAULT 'connections' NOT NULL,
	`linkedin_sub` text NOT NULL,
	`verified_name` text,
	`email` text,
	`verified_email_sha256` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendees_handle_unique` ON `attendees` (`handle`);--> statement-breakpoint
CREATE UNIQUE INDEX `attendees_linkedin_sub_unique` ON `attendees` (`linkedin_sub`);--> statement-breakpoint
CREATE INDEX `attendees_verified_email_sha256` ON `attendees` (`verified_email_sha256`);--> statement-breakpoint
CREATE TABLE `calendar_feeds` (
	`attendee_id` text PRIMARY KEY NOT NULL,
	`token_sha256` text NOT NULL,
	`rotated_at` text NOT NULL,
	FOREIGN KEY (`attendee_id`) REFERENCES `attendees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_feeds_token_sha256_unique` ON `calendar_feeds` (`token_sha256`);--> statement-breakpoint
CREATE TABLE `web_sessions` (
	`id_sha256` text PRIMARY KEY NOT NULL,
	`attendee_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`attendee_id`) REFERENCES `attendees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `web_sessions_attendee_id` ON `web_sessions` (`attendee_id`);