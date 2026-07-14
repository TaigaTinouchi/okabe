CREATE TABLE `job_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_name` text NOT NULL,
	`attempt` integer DEFAULT 1 NOT NULL,
	`status` text NOT NULL,
	`error` text,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE TABLE `read_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_read_event_id` integer DEFAULT 0 NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
