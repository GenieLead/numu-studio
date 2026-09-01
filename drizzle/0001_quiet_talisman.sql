CREATE TABLE `studio_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `studio_directions` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `studio_jobs` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `studio_references` ADD `project_id` text;--> statement-breakpoint

-- Convert the legacy owner-wide timeline into independent projects.
-- The previously tested perfume project was explicitly deleted by the owner,
-- so it is migrated as `deleting`; the authenticated projects endpoint finishes
-- the R2 + D1 purge atomically on the first load after deployment.
INSERT OR IGNORE INTO `studio_projects` (`id`, `owner_email`, `name`, `status`, `created_at`, `updated_at`)
SELECT
	'legacy-perfume:' || `owner_email`,
	`owner_email`,
	'NUMU Desert Essence',
	'deleting',
	MIN(`created_at`),
	MAX(`created_at`)
FROM `studio_directions`
WHERE INSTR(`direction_json`, '"title":"NUMU Desert Essence"') > 0
   OR LOWER(`prompt`) LIKE '%perfume%'
   OR LOWER(`prompt`) LIKE '%fragrance%'
GROUP BY `owner_email`;--> statement-breakpoint

INSERT OR IGNORE INTO `studio_projects` (`id`, `owner_email`, `name`, `status`, `created_at`, `updated_at`)
SELECT
	'legacy-writing:' || `owner_email`,
	`owner_email`,
	'The First Mark',
	'active',
	MIN(`created_at`),
	MAX(`created_at`)
FROM `studio_directions`
WHERE NOT (
	INSTR(`direction_json`, '"title":"NUMU Desert Essence"') > 0
	OR LOWER(`prompt`) LIKE '%perfume%'
	OR LOWER(`prompt`) LIKE '%fragrance%'
)
GROUP BY `owner_email`;--> statement-breakpoint

-- Leave the founder in a genuinely empty project after the deleted perfume test
-- is purged, ready for the guided restart without carrying any old conversation.
INSERT OR IGNORE INTO `studio_projects` (`id`, `owner_email`, `name`, `status`, `created_at`, `updated_at`)
SELECT
	'fresh-restart:' || `owner_email`,
	`owner_email`,
	'Untitled film',
	'active',
	CURRENT_TIMESTAMP,
	CURRENT_TIMESTAMP
FROM `studio_directions`
WHERE INSTR(`direction_json`, '"title":"NUMU Desert Essence"') > 0
   OR LOWER(`prompt`) LIKE '%perfume%'
   OR LOWER(`prompt`) LIKE '%fragrance%'
GROUP BY `owner_email`;--> statement-breakpoint

UPDATE `studio_directions`
SET `project_id` = 'legacy-perfume:' || `owner_email`
WHERE INSTR(`direction_json`, '"title":"NUMU Desert Essence"') > 0
   OR LOWER(`prompt`) LIKE '%perfume%'
   OR LOWER(`prompt`) LIKE '%fragrance%';--> statement-breakpoint

UPDATE `studio_directions`
SET `project_id` = 'legacy-writing:' || `owner_email`
WHERE `project_id` IS NULL;--> statement-breakpoint

UPDATE `studio_jobs`
SET `project_id` = (
	SELECT `project_id` FROM `studio_directions`
	WHERE `studio_directions`.`id` = `studio_jobs`.`direction_id`
);--> statement-breakpoint

UPDATE `studio_references`
SET `project_id` = 'legacy-perfume:' || `owner_email`
WHERE EXISTS (
	SELECT 1 FROM `studio_directions`
	WHERE `studio_directions`.`project_id` = 'legacy-perfume:' || `studio_references`.`owner_email`
	  AND INSTR(`studio_directions`.`reference_ids_json`, `studio_references`.`id`) > 0
);--> statement-breakpoint

UPDATE `studio_references`
SET `project_id` = 'legacy-writing:' || `owner_email`
WHERE `project_id` IS NULL
  AND EXISTS (
	SELECT 1 FROM `studio_directions`
	WHERE `studio_directions`.`project_id` = 'legacy-writing:' || `studio_references`.`owner_email`
	  AND INSTR(`studio_directions`.`reference_ids_json`, `studio_references`.`id`) > 0
);
