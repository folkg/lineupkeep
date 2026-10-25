import { Context, Duration, Effect, Layer } from "effect";
import type { Config, Redacted } from "effect";

import { databaseUrlConfig, decodeDatabaseUrl } from "#config/DatabaseUrl.ts";

export class DatabaseConnection extends Context.Service<
  DatabaseConnection,
  DatabaseConnectionSettings
>()("@sourdough/backend/database/DatabaseConnection") {
  static fromConfig(options: {
    readonly idleTimeout: Duration.Input;
  }): Layer.Layer<DatabaseConnection, Config.ConfigError> {
    return Layer.effect(DatabaseConnection)(
      Effect.gen(function* () {
        const url = yield* databaseUrlConfig;
        return {
          url,
          prepareStatements: true,
          idleTimeout: Duration.fromInputUnsafe(options.idleTimeout),
        };
      }),
    );
  }

  static fromConnectionString(options: {
    readonly connectionString: () => string;
    readonly prepareStatements: boolean;
  }): Layer.Layer<DatabaseConnection, Config.ConfigError> {
    return Layer.effect(DatabaseConnection)(
      Effect.suspend(() => decodeDatabaseUrl(options.connectionString())).pipe(
        Effect.map((url) => ({
          url,
          prepareStatements: options.prepareStatements,
          idleTimeout: Duration.seconds(10),
        })),
      ),
    );
  }
}

export type DatabaseConnectionSettings = {
  readonly url: Redacted.Redacted<string>;
  readonly prepareStatements: boolean;
  readonly idleTimeout: Duration.Duration;
};
