CREATE TABLE `plan_entries` (
	`attendee_id` text NOT NULL,
	`event_id` text NOT NULL,
	`session_id` text NOT NULL,
	`intent` text NOT NULL,
	`source` text NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`added_at` text NOT NULL,
	PRIMARY KEY(`attendee_id`, `event_id`, `session_id`),
	FOREIGN KEY (`event_id`,`session_id`) REFERENCES `sessions`(`event_id`,`session_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "plan_entries_intent" CHECK("plan_entries"."intent" in ('interested', 'reserved')),
	CONSTRAINT "plan_entries_source" CHECK("plan_entries"."source" in ('agent-sync', 'manual'))
);
--> statement-breakpoint
CREATE INDEX `plan_entries_by_session` ON `plan_entries` (`event_id`,`session_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`event_id` text NOT NULL,
	`session_id` text NOT NULL,
	`code` text,
	`title` text,
	`type` text,
	`level` text,
	`venue` text,
	`room` text,
	`starts_at` text,
	`ends_at` text,
	`is_all_day` integer,
	`speakers` text,
	`topics` text,
	`last_seen_at` text NOT NULL,
	PRIMARY KEY(`event_id`, `session_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`event_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_by_start` ON `sessions` (`event_id`,`starts_at`);