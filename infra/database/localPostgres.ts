import * as Output from "alchemy/Output";
import { Effect, Layer } from "effect";

import { localDatabaseName, Postgres, postgresProvider } from "#infra/local/Postgres.ts";
import { DatabaseDeployment } from "#infra/services/DatabaseDeployment.ts";

export function localPostgres(
  stage: string,
): Layer.Layer<DatabaseDeployment, never, Layer.Success<typeof postgresProvider>> {
  return Layer.effect(DatabaseDeployment)(
    Effect.gen(function* () {
      const database = yield* Postgres("Postgres", {
        name: localDatabaseName(stage),
        lockDirectory: new URL("../../.artifacts/.lock", import.meta.url).pathname,
      });
      return {
        runtimeUrl: Output.map(database.url, (url) => url),
        directUrl: Output.map(database.url, (url) => url),
      };
    }),
  );
}
