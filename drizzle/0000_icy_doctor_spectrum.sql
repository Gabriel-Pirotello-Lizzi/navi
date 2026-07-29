CREATE TABLE `transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_email` text NOT NULL,
	`kind` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`occurred_on` text DEFAULT CURRENT_DATE NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
