CREATE TABLE `follows` (
	`follower_id` text NOT NULL,
	`source` text NOT NULL,
	`followee_id` text,
	`github_id` text,
	`since` text NOT NULL,
	FOREIGN KEY (`follower_id`) REFERENCES `attendees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`followee_id`) REFERENCES `attendees`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "follows_target" CHECK(("follows"."source" = 'github' and "follows"."github_id" is not null and "follows"."followee_id" is null) or ("follows"."source" = 'linkedin-import' and "follows"."followee_id" is not null and "follows"."github_id" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `follows_github` ON `follows` (`follower_id`,`github_id`) WHERE "follows"."source" = 'github';--> statement-breakpoint
CREATE UNIQUE INDEX `follows_linkedin_import` ON `follows` (`follower_id`,`followee_id`) WHERE "follows"."source" = 'linkedin-import';--> statement-breakpoint
CREATE INDEX `follows_by_followee` ON `follows` (`followee_id`);--> statement-breakpoint
CREATE INDEX `follows_by_github_id` ON `follows` (`github_id`);--> statement-breakpoint
-- Visibility `connections` is now `network` (#63, ADR 0019): connections and
-- the people the attendee follows. Every existing row keeps its meaning.
UPDATE `attendees` SET `visibility` = 'network' WHERE `visibility` = 'connections';--> statement-breakpoint
-- The column default changes too, which SQLite does by rebuilding the table.
-- D1 ignores `foreign_keys=OFF` (drizzle-kit's way), so the rows that point
-- at attendees would fail the DROP; deferred, they are checked at commit,
-- when `attendees` exists again under its name with every id it had.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__new_attendees` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`handle_placeholder` integer DEFAULT false NOT NULL,
	`display_name` text NOT NULL,
	`headline` text,
	`avatar_url` text,
	`linkedin_profile_url` text,
	`visibility` text DEFAULT 'network' NOT NULL,
	`verified_name` text,
	`email` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_attendees`("id", "handle", "handle_placeholder", "display_name", "headline", "avatar_url", "linkedin_profile_url", "visibility", "verified_name", "email", "created_at") SELECT "id", "handle", "handle_placeholder", "display_name", "headline", "avatar_url", "linkedin_profile_url", "visibility", "verified_name", "email", "created_at" FROM `attendees`;--> statement-breakpoint
DROP TABLE `attendees`;--> statement-breakpoint
ALTER TABLE `__new_attendees` RENAME TO `attendees`;--> statement-breakpoint
PRAGMA defer_foreign_keys = off;--> statement-breakpoint
CREATE UNIQUE INDEX `attendees_handle_unique` ON `attendees` (`handle`);