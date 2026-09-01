ALTER TABLE `studio_directions` ADD `status` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `studio_directions` ADD `current_phase` text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE `studio_directions` ADD `previous_phase` text;--> statement-breakpoint
ALTER TABLE `studio_directions` ADD `phase_started_at` text;--> statement-breakpoint
ALTER TABLE `studio_directions` ADD `provider_request_started` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `studio_directions` ADD `error` text;--> statement-breakpoint
ALTER TABLE `studio_directions` ADD `retryable` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `studio_directions` ADD `updated_at` text DEFAULT '1970-01-01T00:00:00.000Z' NOT NULL;
