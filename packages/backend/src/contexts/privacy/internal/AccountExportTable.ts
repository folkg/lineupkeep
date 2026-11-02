import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const accountExports = pgTable("account_exports", {
  userId: text("user_id").primaryKey(),
  takenAt: timestamp("taken_at", { withTimezone: true }).notNull(),
  contents: jsonb("contents").notNull(),
});
