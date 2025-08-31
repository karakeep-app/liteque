ALTER TABLE `tasks` ADD `availableAt` integer;--> statement-breakpoint
CREATE INDEX `tasks_available_at_idx` ON `tasks` (`availableAt`);