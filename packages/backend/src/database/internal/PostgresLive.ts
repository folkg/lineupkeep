import { PgClient } from "@effect/sql-pg";
import { Effect } from "effect";

import { DatabaseConnection } from "#database/DatabaseConnection.ts";

export const PostgresLive = PgClient.layerFrom(
  Effect.gen(function* () {
    const connection = yield* DatabaseConnection;
    return yield* PgClient.make({
      url: connection.url,
      prepare: connection.prepareStatements,
      idleTimeout: connection.idleTimeout,
    });
  }),
);
