CREATE TABLE `studio_production_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`project_id` text NOT NULL,
	`run_id` text NOT NULL,
	`parent_id` text,
	`level` text NOT NULL,
	`stable_key` text NOT NULL,
	`title` text NOT NULL,
	`order_index` integer DEFAULT 0 NOT NULL,
	`start_ms` integer,
	`duration_ms` integer,
	`state_json` text DEFAULT '{}' NOT NULL,
	`continuity_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_production_node_key_unique` ON `studio_production_nodes` (`run_id`,`stable_key`);--> statement-breakpoint
CREATE INDEX `studio_production_node_parent_index` ON `studio_production_nodes` (`parent_id`);