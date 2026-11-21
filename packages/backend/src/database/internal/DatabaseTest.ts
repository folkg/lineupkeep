import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { EffectString } from "@lineupkeep/collections";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as PgliteDrizzle from "drizzle-orm/postgres/client/effect/pglite";
import { Effect, Layer } from "effect";
import { Array as EffectArray } from "effect";

const migrationsFolderPath = fileURLToPath(new URL("../../../migrations", import.meta.url));
const cacheDirectoryPath = fileURLToPath(
  new URL("../../../../../.artifacts/test-database", import.meta.url),
);

const migratedDatabaseImage = loadOrBuildDatabaseImage();

const testDatabase = createTestDatabase();

export function createTestDatabase(): Promise<PGlite> {
  return migratedDatabaseImage.then((loadDataDir) => {
    const database = new PGlite({ loadDataDir });
    return database.waitReady.then(() => database);
  });
}

export const DatabaseTest = Layer.unwrap(
  Effect.promise(() => testDatabase).pipe(
    Effect.map((database) =>
      PgliteDrizzle.DrizzlePostgresClient.layerFrom(
        Effect.gen(function* () {
          yield* Effect.promise(() => resetTestDatabase(database));
          return yield* PgliteDrizzle.DrizzlePostgresClient.make(database);
        }),
      ),
    ),
  ),
);

export function resetTestDatabase(database: PGlite): Promise<void> {
  return database
    .query<{ readonly tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public'",
    )
    .then((result) => {
      const tables = EffectArray.map(
        result.rows,
        ({ tablename }) => `"${EffectString.replaceAll(tablename, '"', '""')}"`,
      );
      return tables.length === 0
        ? undefined
        : database.exec(
            `TRUNCATE TABLE ${EffectArray.join(tables, ", ")} RESTART IDENTITY CASCADE`,
          );
    })
    .then(() => undefined);
}

function loadOrBuildDatabaseImage(): Promise<Blob> {
  const cachePath = join(cacheDirectoryPath, `${migrationFingerprint()}.pglite`);
  let cached: Buffer | undefined;
  try {
    cached = readFileSync(cachePath);
  } catch {
    cached = undefined;
  }
  if (cached !== undefined) {
    return Promise.resolve(new Blob([new Uint8Array(cached)]));
  }

  return buildMigratedDatabaseImage().then((image) =>
    writeCache(cachePath, image).then(() => image),
  );
}

function migrationFingerprint(): string {
  const hash = createHash("sha256");
  const names = EffectArray.map(
    EffectArray.filter(
      readdirSync(migrationsFolderPath, { recursive: true, withFileTypes: true }),
      (entry) => entry.isFile(),
    ),
    (entry) => join(entry.parentPath, entry.name),
  ).sort();
  for (const name of names) {
    hash.update(name);
    hash.update(readFileSync(name));
  }
  return EffectString.slice(hash.digest("hex"), 0, 20);
}

function writeCache(cachePath: string, image: Blob): Promise<void> {
  const temporaryPath = `${cachePath}.${String(process.pid)}.${randomUUID()}.tmp`;
  return image.arrayBuffer().then(
    (buffer) => {
      try {
        mkdirSync(cacheDirectoryPath, { recursive: true });
        writeFileSync(temporaryPath, new Uint8Array(buffer));
        renameSync(temporaryPath, cachePath);
      } catch {
        rmSync(temporaryPath, { force: true });
      }
    },
    () => rmSync(temporaryPath, { force: true }),
  );
}

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
