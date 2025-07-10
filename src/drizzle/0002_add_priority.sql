ALTER TABLE `tasks` ADD `priority` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `tasks_priority_idx` ON `tasks` (`priority`);