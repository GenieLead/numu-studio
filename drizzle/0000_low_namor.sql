CREATE TABLE `studio_directions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`prompt` text NOT NULL,
	`reference_ids_json` text DEFAULT '[]' NOT NULL,
	`direction_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `studio_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`direction_id` text NOT NULL,
	`provider_job_id` text NOT NULL,
	`polling_url` text NOT NULL,
	`status` text NOT NULL,
	`model` text NOT NULL,
	`max_cost_usd` text NOT NULL,
	`actual_cost_usd` text,
	`request_json` text NOT NULL,
	`response_json` text NOT NULL,
	`output_object_key` text,
	`output_sha256` text,
	`error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_jobs_direction_unique` ON `studio_jobs` (`direction_id`);--> statement-breakpoint
CREATE TABLE `studio_references` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`object_key` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
