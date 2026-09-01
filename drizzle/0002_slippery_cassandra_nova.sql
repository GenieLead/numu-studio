CREATE TABLE `studio_production_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`project_id` text NOT NULL,
	`direction_id` text NOT NULL,
	`run_id` text NOT NULL,
	`stage` text NOT NULL,
	`kind` text NOT NULL,
	`shot_id` text,
	`label` text NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`approval_status` text DEFAULT 'pending' NOT NULL,
	`order_index` integer DEFAULT 0 NOT NULL,
	`object_key` text,
	`mime_type` text,
	`model` text,
	`prompt` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`estimated_cost_usd` text,
	`actual_cost_usd` text,
	`error` text,
	`approved_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_production_artifact_slot_unique` ON `studio_production_artifacts` (`run_id`,`stage`,`kind`,`shot_id`,`order_index`);--> statement-breakpoint
CREATE TABLE `studio_production_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`project_id` text NOT NULL,
	`direction_id` text NOT NULL,
	`pipeline_version` text DEFAULT 'studio-v2' NOT NULL,
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
CREATE UNIQUE INDEX `studio_production_runs_direction_unique` ON `studio_production_runs` (`direction_id`);--> statement-breakpoint
CREATE TABLE `studio_production_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`project_id` text NOT NULL,
	`direction_id` text NOT NULL,
	`run_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`provider_job_id` text NOT NULL,
	`polling_url` text NOT NULL,
	`status` text NOT NULL,
	`model` text NOT NULL,
	`max_cost_usd` text NOT NULL,
	`actual_cost_usd` text,
	`request_json` text NOT NULL,
	`response_json` text DEFAULT '{}' NOT NULL,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_production_tasks_artifact_unique` ON `studio_production_tasks` (`artifact_id`);