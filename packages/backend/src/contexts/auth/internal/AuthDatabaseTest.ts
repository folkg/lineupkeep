import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Context, Effect, Layer } from "effect";

import { AuthDatabase } from "./AuthDatabase.ts";
import { authRelations } from "./AuthDatabase.ts";

export class AuthDatabaseStatements extends Context.Service<
  AuthDatabaseStatements,
  ReadonlyArray<string>
>()("@sourdough/backend/contexts/auth/internal/AuthDatabaseTest/AuthDatabaseStatements") {}

export const AuthDatabaseTest = Layer.effectContext(
  Effect.gen(function* () {
    const client = yield* Effect.acquireRelease(
      Effect.sync(() => new PGlite()),
      (client) => Effect.promise(() => client.close()),
    );
    yield* Effect.promise(() =>
      migrate(drizzle({ client }), { migrationsFolder: migrationsFolderPath }),
    );
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

const migrationsFolderPath = fileURLToPath(new URL("../../../../migrations", import.meta.url));
