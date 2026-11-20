import * as PostgresDrizzle from "drizzle-orm/postgres/effect";
import { Effect } from "effect";

import { DatabaseConnection } from "#database/DatabaseConnection.ts";

export const PostgresLive = PostgresDrizzle.DrizzlePostgresClient.layerFrom(
  Effect.gen(function* () {
    const connection = yield* DatabaseConnection;
    return yield* PostgresDrizzle.DrizzlePostgresClient.make({
      url: connection.url,
      prepare: connection.prepareStatements,
      idleTimeout: connection.idleTimeout,
    });
  }),
);
