import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { PgliteClient } from "@effect/sql-pglite";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Effect, Layer } from "effect";

const migrationsFolderPath = fileURLToPath(new URL("../../../migrations", import.meta.url));
const cacheDirectoryPath = fileURLToPath(
  new URL("../../../../../.artifacts/test-database", import.meta.url),
);

export const migratedDatabaseImage = loadOrBuildDatabaseImage();

export const DatabaseTest = Layer.unwrap(
  Effect.promise(() => migratedDatabaseImage).pipe(
    Effect.map((loadDataDir) => PgliteClient.layer({ loadDataDir })),
  ),
);

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
  const names = readdirSync(migrationsFolderPath, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
  for (const name of names) {
    hash.update(name);
    hash.update(readFileSync(name));
  }
  return hash.digest("hex").slice(0, 20);
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
