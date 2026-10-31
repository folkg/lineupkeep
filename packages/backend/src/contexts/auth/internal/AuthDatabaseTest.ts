import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Context, Effect, Layer } from "effect";

import { migratedDatabaseImage } from "#database/internal/DatabaseTest.ts";

import { AuthDatabase } from "./AuthDatabase.ts";
import { authRelations } from "./AuthDatabase.ts";

export class AuthDatabaseStatements extends Context.Service<
  AuthDatabaseStatements,
  ReadonlyArray<string>
>()("@lineupkeep/backend/contexts/auth/internal/AuthDatabaseTest/AuthDatabaseStatements") {}

export const AuthDatabaseTest = Layer.effectContext(
  Effect.gen(function* () {
    const loadDataDir = yield* Effect.promise(() => migratedDatabaseImage);
    const client = yield* Effect.acquireRelease(
      Effect.sync(() => new PGlite({ loadDataDir })),
      (client) => Effect.promise(() => client.close()),
    );
    yield* Effect.promise(() => client.waitReady);
    const statements: Array<string> = [];
    const database = drizzle({
      client,
      relations: authRelations,
      logger: {
        logQuery: (query) => {
          statements.push(query);
        },
      },
    });
    return Context.make(AuthDatabase, database).pipe(
      Context.add(AuthDatabaseStatements, statements),
    );
  }),
);
