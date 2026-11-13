CREATE TABLE `events` (
	`event_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL
);
