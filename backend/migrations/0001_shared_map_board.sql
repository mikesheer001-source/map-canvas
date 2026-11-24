CREATE TABLE IF NOT EXISTS `shared_map_board` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`value` text NOT NULL
);
