PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_studio_production_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`project_id` text NOT NULL,
	`direction_id` text NOT NULL,
	`pipeline_version` text DEFAULT 'studio-v3' NOT NULL,
	`mode` text DEFAULT 'studio-cut' NOT NULL,
	`current_stage` text DEFAULT 'evidence' NOT NULL,
	`status` text DEFAULT 'awaiting_evidence' NOT NULL,
	`estimated_cost_usd` text,
	`approved_cost_usd` text,
	`actual_cost_usd` text DEFAULT '0' NOT NULL,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_studio_production_runs`("id", "owner_email", "project_id", "direction_id", "pipeline_version", "mode", "current_stage", "status", "estimated_cost_usd", "approved_cost_usd", "actual_cost_usd", "error", "created_at", "updated_at") SELECT "id", "owner_email", "project_id", "direction_id", "pipeline_version", "mode", "current_stage", "status", "estimated_cost_usd", "approved_cost_usd", "actual_cost_usd", "error", "created_at", "updated_at" FROM `studio_production_runs`;--> statement-breakpoint
DROP TABLE `studio_production_runs`;--> statement-breakpoint
ALTER TABLE `__new_studio_production_runs` RENAME TO `studio_production_runs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `studio_production_runs_direction_unique` ON `studio_production_runs` (`direction_id`);