DROP INDEX `studio_production_tasks_artifact_unique`;--> statement-breakpoint
CREATE INDEX `studio_production_tasks_artifact_index` ON `studio_production_tasks` (`artifact_id`);