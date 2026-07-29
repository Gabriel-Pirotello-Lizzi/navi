import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const transactions = sqliteTable(
  "transactions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userEmail: text("user_email").notNull(),
    kind: text("kind", { enum: ["expense", "income"] }).notNull(),
    amountCents: integer("amount_cents").notNull(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    occurredOn: text("occurred_on").notNull().default(sql`CURRENT_DATE`),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => [index("transactions_user_date_idx").on(table.userEmail, table.occurredOn)],
);
