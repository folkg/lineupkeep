import { defineConfig } from "drizzle-kit";
import { Config, Effect } from "effect";

const databaseUrl = Effect.runSync(Config.NonEmptyString("DATABASE_URL"));

export default defineConfig({
  schema: "./packages/backend/src/contexts/*/internal/**/*{Table,Tables}.ts",
  out: "./packages/backend/migrations",
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: {
    url: databaseUrl,
  },
});
