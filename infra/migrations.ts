import * as Command from "alchemy/Command";
import * as Output from "alchemy/Output";
import type { Provider } from "alchemy/Provider";
import { Effect } from "effect";

import type { DatabaseOutputs } from "./services/DatabaseDeployment.ts";

export function migrate(
  database: DatabaseOutputs,
): Effect.Effect<DatabaseOutputs, never, Provider<Command.Exec>> {
  return Effect.gen(function* () {
    const migration = yield* Command.Exec("Migrate", {
      cwd: new URL("../", import.meta.url).pathname,
      command:
        "node node_modules/drizzle-kit/bin.cjs migrate --config=packages/backend/drizzle.config.ts",
      env: { DATABASE_URL: database.directUrl },
      memo: false,
      timeout: "5 minutes",
    });
    return {
      ...database,
      runtimeUrl: Output.map(Output.all(database.runtimeUrl, migration.hash.input), ([url]) => url),
      directUrl: Output.map(Output.all(database.directUrl, migration.hash.input), ([url]) => url),
    };
  });
}
