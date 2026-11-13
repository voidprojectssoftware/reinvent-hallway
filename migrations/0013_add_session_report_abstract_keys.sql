ALTER TABLE `session_reports` ADD `abstract_key` text;--> statement-breakpoint
CREATE INDEX `session_reports_by_abstract` ON `session_reports` (`event_id`,`session_id`,`abstract_key`);