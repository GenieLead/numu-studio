ALTER TABLE `studio_projects` ADD `draft_prompt` text;--> statement-breakpoint
ALTER TABLE `studio_projects` ADD `draft_reference_ids_json` text DEFAULT '[]' NOT NULL;