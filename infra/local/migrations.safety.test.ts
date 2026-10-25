import assert from "node:assert/strict";
import { access, rm } from "node:fs/promises";

import { docker } from "@lineupkeep/tools/local-stack/postgresContainer.ts";
import * as Test from "alchemy/Test/Vitest";
import { Effect, Exit } from "effect";

import { localDatabaseName } from "./Postgres.ts";
import { migrationSafety, readSafetyRun } from "./safety.ts";

const { run } = await readSafetyRun();
const healthy = migrationSafety(run, false);
const { afterAll, deploy, destroy, test } = Test.make(healthy.options);
afterAll(destroy(healthy.stack));

test(
  "blocks activation on migration failure and retries without replacing the Drizzle ledger",
  Effect.gen(function* () {
    yield* Effect.promise(() => rm(healthy.marker, { force: true }));

    const failed = yield* deploy(migrationSafety(run, true).stack).pipe(Effect.exit);
    assert.equal(Exit.isFailure(failed), true);
    assert.equal(
      yield* Effect.promise(() =>
        access(healthy.marker).then(
          () => true,
          () => false,
        ),
      ),
      false,
    );

    yield* deploy(healthy.stack);
    yield* Effect.promise(() => access(healthy.marker));
    const before = yield* ledgerCount();
    assert.ok(before > 0);
    yield* deploy(healthy.stack);
    assert.equal(yield* ledgerCount(), before);
  }),
);

function ledgerCount(): Effect.Effect<number, never, never> {
  return Effect.promise(async () =>
    Number(
      await docker([
        "exec",
        localDatabaseName(healthy.options.stage),
        "psql",
        "-U",
        "lineupkeep",
        "-d",
        "lineupkeep_test",
        "-Atc",
        "SELECT count(*) FROM drizzle.__drizzle_migrations",
      ]),
    ),
  );
}
