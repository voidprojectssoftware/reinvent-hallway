CREATE TABLE `last_syncs` (
	`attendee_id` text NOT NULL,
	`event_id` text NOT NULL,
	`synced_at` text NOT NULL,
	`added` integer NOT NULL,
	`removed` integer NOT NULL,
	`changed` integer NOT NULL,
	`unchanged` integer NOT NULL,
	`missing_sessions` integer NOT NULL,
	PRIMARY KEY(`attendee_id`, `event_id`),
	FOREIGN KEY (`event_id`) REFERENCES `events`(`event_id`) ON UPDATE no action ON DELETE no action
);
