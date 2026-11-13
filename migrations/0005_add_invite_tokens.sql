CREATE TABLE `invite_tokens` (
	`attendee_id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`rotated_at` text NOT NULL,
	FOREIGN KEY (`attendee_id`) REFERENCES `attendees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invite_tokens_token_unique` ON `invite_tokens` (`token`);