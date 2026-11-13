CREATE TABLE `linkedin_post_drafts` (
	`state_sha256` text PRIMARY KEY NOT NULL,
	`attendee_id` text NOT NULL,
	`text` text NOT NULL,
	`selection` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`attendee_id`) REFERENCES `attendees`(`id`) ON UPDATE no action ON DELETE no action
);
