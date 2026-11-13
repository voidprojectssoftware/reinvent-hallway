CREATE TABLE `connection_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`from_id` text NOT NULL,
	`to_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	`decided_at` text,
	FOREIGN KEY (`from_id`) REFERENCES `attendees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_id`) REFERENCES `attendees`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "connection_requests_status" CHECK("connection_requests"."status" in ('pending', 'accepted', 'declined', 'withdrawn'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connection_requests_one_pending` ON `connection_requests` (`from_id`,`to_id`) WHERE "connection_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX `connection_requests_to` ON `connection_requests` (`to_id`,`status`);--> statement-breakpoint
CREATE TABLE `connections` (
	`a` text NOT NULL,
	`b` text NOT NULL,
	`since` text NOT NULL,
	`via` text NOT NULL,
	PRIMARY KEY(`a`, `b`),
	FOREIGN KEY (`a`) REFERENCES `attendees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`b`) REFERENCES `attendees`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "connections_ordered" CHECK("connections"."a" < "connections"."b"),
	CONSTRAINT "connections_via" CHECK("connections"."via" in ('request', 'share-link'))
);
--> statement-breakpoint
CREATE INDEX `connections_by_b` ON `connections` (`b`);--> statement-breakpoint
CREATE TABLE `contact_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`attendee_id` text NOT NULL,
	`imported_at` text NOT NULL,
	`count` integer NOT NULL,
	FOREIGN KEY (`attendee_id`) REFERENCES `attendees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_imports_attendee_id_unique` ON `contact_imports` (`attendee_id`);--> statement-breakpoint
CREATE TABLE `imported_contacts` (
	`import_id` text NOT NULL,
	`profile_url` text,
	`name` text NOT NULL,
	`email_sha256` text,
	FOREIGN KEY (`import_id`) REFERENCES `contact_imports`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `imported_contacts_by_import` ON `imported_contacts` (`import_id`);