import { fileURLToPath } from "node:url";

import { PgliteClient } from "@effect/sql-pglite";
import * as PgliteDrizzle from "drizzle-orm/effect-pglite";
import { migrate } from "drizzle-orm/effect-pglite/migrator";
import { Effect, Layer } from "effect";

export const DatabaseTest = Layer.effectDiscard(
  Effect.gen(function* () {
    const database = yield* PgliteDrizzle.makeWithDefaults();
    yield* migrate(database, { migrationsFolder: migrationsFolderPath });
  }),
).pipe(Layer.provideMerge(PgliteClient.layer()));

const migrationsFolderPath = fileURLToPath(new URL("../../../migrations", import.meta.url));
