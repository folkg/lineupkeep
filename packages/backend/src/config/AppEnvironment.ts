import { Config } from "effect";

export const appEnvironmentConfig = Config.Literals(
  ["development", "production", "test"],
  "APP_ENV",
).pipe(
  Config.orElse(() => Config.Literals(["development", "production", "test"], "NODE_ENV")),
  Config.withDefault("development"),
);

export type AppEnvironment = "development" | "production" | "test";
