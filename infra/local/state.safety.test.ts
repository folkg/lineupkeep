import assert from "node:assert/strict";

import { NodeServices } from "@effect/platform-node";
import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Command from "alchemy/Command";
import { State } from "alchemy/State";
import * as Core from "alchemy/Test/Core";
import * as Test from "alchemy/Test/Vitest";
import { ConfigProvider, Effect, Layer, Result } from "effect";

import { deploymentState } from "#infra/state.ts";

import { readSafetyRun } from "./safety.ts";

const { test } = Test.make({ providers: Layer.empty, dev: true, sidecar: false });

test(
  "excludes concurrent state owners and preserves independent state across application destroy",
  Effect.gen(function* () {
    const { run, database } = yield* Effect.promise(readSafetyRun);
    yield* proveLocks(database);
    yield* proveDestroyIsolation(database, run.stage);
  }),
);

function proveLocks(
  url: string,
): Effect.Effect<void, import("alchemy/State").StateStoreError, never> {
  const request = { stack: "LockProbe", stage: "same-stage" };
  return Effect.gen(function* () {
    yield* withState(url, (holder) =>
      Effect.gen(function* () {
        yield* holder.setOutput({ ...request, value: { retained: true } });
        yield* withState(url, (contender) =>
          Effect.gen(function* () {
            const result = yield* contender.getOutput(request).pipe(Effect.result);
            assert.ok(Result.isFailure(result));
            assert.match(result.failure.message, /another deploy holds the Postgres state lock/u);

            yield* contender.setOutput({ ...request, stage: "other-stage", value: "independent" });
          }),
        );
      }),
    );

    yield* withState(url, (successor) =>
      Effect.gen(function* () {
        assert.deepEqual(yield* successor.getOutput(request), { retained: true });
        assert.equal(
          yield* successor.getOutput({ ...request, stage: "other-stage" }),
          "independent",
        );
      }),
    );
  });
}

function proveDestroyIsolation(
  url: string,
  stage: string,
): Effect.Effect<void, import("alchemy/State").StateStoreError, never> {
  const providers = Command.providers();
  const state = configuredState(url);
  const options = { providers, state, stage, dev: false, sidecar: false };
  const application = probeStack("StateApplicationProbe", providers, state);
  const durable = probeStack("StateDurableProbe", providers, state);
  const applicationKey = { stack: "StateApplicationProbe", stage };
  const durableKey = { stack: "StateDurableProbe", stage };

  return Effect.gen(function* () {
    yield* Effect.promise(() => Core.run(Core.deploy(options, durable), options));
    yield* Effect.promise(() => Core.run(Core.deploy(options, application), options));
    yield* withState(url, (store) =>
      Effect.gen(function* () {
        assert.deepEqual(yield* store.list(applicationKey), ["Probe"]);
      }),
    );
    yield* Effect.promise(() => Core.run(Core.destroy(options, application), options));

    yield* withState(url, (store) =>
      Effect.gen(function* () {
        assert.deepEqual(yield* store.list(durableKey), ["Probe"]);
        assert.deepEqual(yield* store.getOutput(durableKey), { marker: "retained" });
        assert.deepEqual(yield* store.list(applicationKey), []);
        assert.equal(yield* store.getOutput(applicationKey), undefined);
      }),
    );

    yield* Effect.promise(() => Core.run(Core.destroy(options, durable), options));
  });
}

function probeStack(
  name: string,
  providers: ReturnType<typeof Command.providers>,
  state: ReturnType<typeof configuredState>,
): ReturnType<typeof Alchemy.Stack<{ readonly marker: string }, Alchemy.Provider<Command.Exec>>> {
  return Alchemy.Stack(
    name,
    { providers, state },
    Effect.gen(function* () {
      yield* Command.Exec("Probe", { command: "node -e ''", shell: true, memo: false });
      return { marker: "retained" };
    }),
  );
}

function withState<A, E>(
  url: string,
  use: (state: import("alchemy/State").StateService) => Effect.Effect<A, E>,
): Effect.Effect<A, E, never> {
  return Effect.scoped(
    State.pipe(
      Effect.flatten,
      Effect.flatMap(use),
      Effect.provide(configuredState(url)),
      Effect.provideService(AlchemyContext, { dev: false, adopt: false, dotAlchemy: ".alchemy" }),
      Effect.provide(NodeServices.layer),
    ),
  );
}

function configuredState(
  url: string,
): Layer.Layer<State, never, AlchemyContext | Layer.Services<typeof deploymentState>> {
  return Layer.fresh(deploymentState).pipe(
    Layer.provide(
      ConfigProvider.layer(ConfigProvider.fromUnknown({ ALCHEMY_STATE_DATABASE_URL: url })),
    ),
  );
}
