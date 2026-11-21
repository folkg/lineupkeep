import { drizzle } from "drizzle-orm/pglite";
import { Context, Effect, Layer } from "effect";

import { createTestDatabase, resetTestDatabase } from "#database/internal/DatabaseTest.ts";

import { AuthDatabase } from "./AuthDatabase.ts";
import { authRelations } from "./AuthDatabase.ts";

export class AuthDatabaseStatements extends Context.Service<
  AuthDatabaseStatements,
  ReadonlyArray<string>
>()("@lineupkeep/backend/contexts/auth/internal/AuthDatabaseTest/AuthDatabaseStatements") {}

const testDatabase = createTestDatabase();

export const AuthDatabaseTest = Layer.effectContext(
  Effect.gen(function* () {
    const client = yield* Effect.promise(() => testDatabase);
    yield* Effect.promise(() => resetTestDatabase(client));
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
