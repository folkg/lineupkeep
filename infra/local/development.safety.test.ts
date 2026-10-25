import assert from "node:assert/strict";

import { docker } from "@sourdough/tools/local-stack/postgresContainer.ts";
import * as Test from "alchemy/Test/Vitest";
import { Effect, Redacted } from "effect";

import { developmentDatabaseIdentity, resetDevelopmentDatabase } from "./developmentDatabase.ts";
import { cleanSafetyResources, developmentSafety, readSafetyRun } from "./safety.ts";

const { run } = await readSafetyRun();
const { identity, options, stack } = developmentSafety(run);
const id = identity.name;
const { deploy, destroy, afterAll, test } = Test.make(options);
afterAll(
  Effect.gen(function* () {
    yield* destroy(stack);
    yield* Effect.promise(() => resetDevelopmentDatabase(identity));
  }),
);

test(
  "retains named-volume data across stop/start and deletes it only on explicit reset",
  Effect.gen(function* () {
    const first = yield* deploy(stack);
    assert.equal(new URL(Redacted.value(first.url)).hostname, "127.0.0.1");
    yield* query(
      "CREATE TABLE persistence_probe (value text); INSERT INTO persistence_probe VALUES ('retained')",
    );
    assert.equal(yield* query("SELECT value FROM persistence_probe"), "retained");
    assert.equal(
      yield* Effect.promise(() =>
        docker(["inspect", "--format", "{{.HostConfig.RestartPolicy.Name}}", id]),
      ),
      "no",
    );
    assert.equal(developmentDatabaseIdentity().restartPolicy, "unless-stopped");

    yield* destroy(stack);
    assert.equal(
      yield* Effect.promise(() => docker(["inspect", "--format", "{{.State.Running}}", id])),
      "false",
    );
    yield* Effect.promise(() => docker(["volume", "inspect", identity.volume]));
    yield* deploy(stack);
    assert.equal(yield* query("SELECT value FROM persistence_probe"), "retained");

    yield* destroy(stack);
    yield* Effect.promise(() => resetDevelopmentDatabase(identity));
    assert.equal(
      yield* Effect.promise(() =>
        docker(["volume", "ls", "--quiet", "--filter", `name=^${identity.volume}$`]),
      ),
      "",
    );
    yield* deploy(stack);
    assert.equal(yield* query("SELECT to_regclass('public.persistence_probe') IS NULL"), "t");
  }),
);

test(
  "recovers a running safety container after its resource record is destroyed",
  Effect.gen(function* () {
    yield* deploy(stack);
    yield* destroy(stack);
    yield* Effect.promise(() => docker(["start", id]));
    assert.equal(
      yield* Effect.promise(() => docker(["inspect", "--format", "{{.State.Running}}", id])),
      "true",
    );

    yield* Effect.promise(() =>
      assert.rejects(
        resetDevelopmentDatabase({ ...identity, checkout: `${identity.checkout}/foreign` }),
        /different ownership or storage/u,
      ),
    );
    yield* Effect.promise(() =>
      assert.rejects(
        resetDevelopmentDatabase({ ...identity, volume: `${identity.volume}-foreign` }),
        /different ownership or storage/u,
      ),
    );
    assert.equal(
      yield* Effect.promise(() => docker(["inspect", "--format", "{{.State.Running}}", id])),
      "true",
    );

    yield* Effect.promise(() => cleanSafetyResources(run));
    yield* Effect.promise(() => cleanSafetyResources(run));

    assert.equal(
      yield* Effect.promise(() => docker(["ps", "--all", "--quiet", "--filter", `name=^/${id}$`])),
      "",
    );
    assert.equal(
      yield* Effect.promise(() =>
        docker(["volume", "ls", "--quiet", "--filter", `name=^${identity.volume}$`]),
      ),
      "",
    );
  }),
);

function query(statement: string): Effect.Effect<string, never, never> {
  return Effect.promise(() =>
    docker(["exec", id, "psql", "-U", "sourdough_dev", "-d", "sourdough_dev", "-Atc", statement]),
  );
}
