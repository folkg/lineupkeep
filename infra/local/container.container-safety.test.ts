import assert from "node:assert/strict";

import { it } from "@effect/vitest";
import { docker, removeOwnedContainer } from "@sourdough/tools/local-stack/postgresContainer.ts";
import { Effect, Schema, Schedule } from "effect";

import { readSafetyRun } from "./safety.ts";

it.live("retains image safety settings, rejects foreign ownership and stops gracefully", () =>
  Effect.gen(function* () {
    const { run } = yield* Effect.promise(readSafetyRun);
    const name = `${run.databaseName}-web`;
    const [container] = yield* Effect.promise(async () =>
      Schema.decodeSync(Inspection)(await docker(["inspect", name])),
    );
    assert.ok(container);
    assert.deepEqual(container.Config.Cmd, ["node", "server/index.mjs"]);
    assert.equal(container.Config.User, "node");
    assert.equal(container.Config.StopSignal, "SIGTERM");
    assert.equal(container.Config.Labels["sourdough.disposable"], "test-web");
    assert.equal(container.Config.StopTimeout, 30);
    assert.match(container.Config.Healthcheck.Test.join(" "), /fetch/);
    assert.ok(
      container.Config.Env.some((value) =>
        value.startsWith("OTEL_EXPORTER_OTLP_ENDPOINT=http://host.docker.internal:"),
      ),
    );
    yield* Effect.tryPromise(async () => {
      assert.equal(
        await docker(["inspect", "--format", "{{.State.Health.Status}}", name]),
        "healthy",
      );
    }).pipe(Effect.retry({ schedule: Schedule.spaced("1 second"), times: 40 }));
    yield* Effect.promise(() =>
      assert.rejects(
        () =>
          removeOwnedContainer(
            name,
            "not-this-checkout",
            "test-web",
            AbortSignal.timeout(5000),
            true,
          ),
        /different ownership labels/u,
      ),
    );

    yield* Effect.promise(() => docker(["stop", name]));
    const [stopped] = yield* Effect.promise(async () =>
      Schema.decodeSync(Inspection)(await docker(["inspect", name])),
    );

    assert.equal(stopped?.State.ExitCode, 0);
  }),
);

const Inspection = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      Config: Schema.Struct({
        Cmd: Schema.Array(Schema.String),
        Env: Schema.Array(Schema.String),
        User: Schema.String,
        StopSignal: Schema.String,
        StopTimeout: Schema.Number,
        Labels: Schema.Record(Schema.String, Schema.String),
        Healthcheck: Schema.Struct({ Test: Schema.Array(Schema.String) }),
      }),
      State: Schema.Struct({ ExitCode: Schema.Number }),
    }),
  ),
);
