CREATE TABLE `hidden_sessions` (
	`attendee_id` text NOT NULL,
	`event_id` text NOT NULL,
	`session_id` text NOT NULL,
	PRIMARY KEY(`attendee_id`, `event_id`, `session_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`event_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `session_reports` (
	`event_id` text NOT NULL,
	`session_id` text NOT NULL,
	`attendee_id` text NOT NULL,
	`reported_at` text NOT NULL,
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
	`code_folded` text,
	`title_folded` text,
	`speakers_folded` text,
	PRIMARY KEY(`event_id`, `session_id`, `attendee_id`),
	FOREIGN KEY (`event_id`,`session_id`) REFERENCES `sessions`(`event_id`,`session_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `session_reports_by_attendee` ON `session_reports` (`attendee_id`,`event_id`);--> statement-breakpoint
ALTER TABLE `plan_entries` ADD `invited` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `code_folded` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `title_folded` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `speakers_folded` text;--> statement-breakpoint
-- Data, written by hand (issue #53). Hiding moves from the entry to the
-- attendee's hidden set; 0009 then drops plan_entries.hidden.
INSERT INTO `hidden_sessions` (`attendee_id`, `event_id`, `session_id`)
	SELECT `attendee_id`, `event_id`, `session_id` FROM `plan_entries` WHERE `hidden` = 1;--> statement-breakpoint
-- The folded search text. SQL cannot fold accents, so rows stored before this
-- migration get SQLite's ASCII lower() until their next report rewrites them
-- through the domain's foldText. Nothing is deployed yet (AGENTS.md).
UPDATE `sessions` SET
	`code_folded` = lower(`code`),
	`title_folded` = lower(`title`),
	`speakers_folded` = (SELECT group_concat(lower(`value`), char(10)) FROM json_each(`sessions`.`speakers`));--> statement-breakpoint
-- Each catalog row so far came from some attendee's sync: count it as the
-- report of every attendee whose agent has the session on their schedule, so
-- the first consensus after this migration does not start from nothing.
INSERT INTO `session_reports`
	SELECT s.`event_id`, s.`session_id`, p.`attendee_id`, s.`last_seen_at`,
		s.`code`, s.`title`, s.`type`, s.`level`, s.`venue`, s.`room`, s.`starts_at`, s.`ends_at`,
		s.`is_all_day`, s.`speakers`, s.`topics`, s.`code_folded`, s.`title_folded`, s.`speakers_folded`
	FROM `sessions` s
	JOIN `plan_entries` p ON p.`event_id` = s.`event_id` AND p.`session_id` = s.`session_id`
	WHERE p.`source` = 'agent-sync';
