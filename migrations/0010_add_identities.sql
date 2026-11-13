CREATE TABLE `identities` (
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`attendee_id` text NOT NULL,
	`email` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`verified_email_sha256` text,
	`username` text,
	`linked_at` text NOT NULL,
	PRIMARY KEY(`provider`, `subject`),
	FOREIGN KEY (`attendee_id`) REFERENCES `attendees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identities_attendee_provider` ON `identities` (`attendee_id`,`provider`);--> statement-breakpoint
CREATE INDEX `identities_verified_email_sha256` ON `identities` (`verified_email_sha256`);--> statement-breakpoint
-- Every existing attendee keeps their way in (#60). LinkedIn sign-in kept
-- the subject in attendees.linkedin_sub; dev sign-in kept `dev:<name>` there.
-- The email was only ever stored when LinkedIn said it was verified.
INSERT INTO `identities` (`provider`, `subject`, `attendee_id`, `email`, `email_verified`, `verified_email_sha256`, `username`, `linked_at`)
SELECT
	CASE WHEN `linkedin_sub` LIKE 'dev:%' THEN 'dev' ELSE 'linkedin' END,
	CASE WHEN `linkedin_sub` LIKE 'dev:%' THEN substr(`linkedin_sub`, 5) ELSE `linkedin_sub` END,
	`id`,
	`email`,
	`email` IS NOT NULL AND `verified_email_sha256` IS NOT NULL,
	`verified_email_sha256`,
	NULL,
	`created_at`
FROM `attendees`;--> statement-breakpoint
DROP INDEX `attendees_linkedin_sub_unique`;--> statement-breakpoint
DROP INDEX `attendees_verified_email_sha256`;--> statement-breakpoint
ALTER TABLE `attendees` DROP COLUMN `linkedin_sub`;--> statement-breakpoint
ALTER TABLE `attendees` DROP COLUMN `verified_email_sha256`;