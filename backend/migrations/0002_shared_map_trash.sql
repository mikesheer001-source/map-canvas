CREATE TABLE IF NOT EXISTS `shared_map_trash` (
	`id` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`version` integer NOT NULL,
	`deleted_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `shared_map_trash_deleted_at` ON `shared_map_trash` (`deleted_at`);