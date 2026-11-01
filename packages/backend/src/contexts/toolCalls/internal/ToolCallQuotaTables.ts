import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const toolCallQuota = pgTable("tool_call_quota", {
  key: text("key").primaryKey(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  count: integer("count").notNull(),
});
