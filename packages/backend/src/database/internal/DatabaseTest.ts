import { fileURLToPath } from "node:url";

import { PgliteClient } from "@effect/sql-pglite";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Effect, Layer } from "effect";

const migrationsFolderPath = fileURLToPath(new URL("../../../migrations", import.meta.url));

export const migratedDatabaseImage = buildMigratedDatabaseImage();

export const DatabaseTest = Layer.unwrap(
  Effect.promise(() => migratedDatabaseImage).pipe(
    Effect.map((loadDataDir) => PgliteClient.layer({ loadDataDir })),
  ),
);

function buildMigratedDatabaseImage(): Promise<Blob> {
  return Effect.runPromise(
    Effect.acquireUseRelease(
      Effect.sync(() => new PGlite()),
      (template) =>
        Effect.gen(function* () {
          yield* Effect.promise(() =>
            migrate(drizzle({ client: template }), { migrationsFolder: migrationsFolderPath }),
          );
          return yield* Effect.promise(() => template.dumpDataDir("none"));
        }),
      (template) => Effect.promise(() => template.close()),
    ),
  );
}
