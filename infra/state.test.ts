import { NodeServices } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { State } from "alchemy/State";
import { Cause, ConfigProvider, Effect } from "effect";
import { expect } from "vitest";

import { deploymentState } from "./state.ts";

it.effect("requires shared state configuration before any nonlocal state operation", () =>
  Effect.forEach([{}, { ALCHEMY_STATE_DATABASE_URL: "" }], (config) =>
    stateFailure(config).pipe(
      Effect.map((error) => {
        expect(error).toContain("ALCHEMY_STATE_DATABASE_URL");
        expect(error).toContain("required for non-local plan, deploy and destroy");
      }),
    ),
  ),
);

it.effect("keeps local state even when shared credentials are absent or invalid", () =>
  Effect.gen(function* () {
    expect((yield* selectedState(true, {})).id).toBe("local");
    expect((yield* selectedState(true, { ALCHEMY_STATE_DATABASE_URL: "not-a-url" })).id).toBe(
      "local",
    );
  }),
);

it.effect("rejects Neon's transaction pooler without exposing state credentials", () =>
  Effect.forEach(
    ["ep-state-pooler.us-east-1.aws.neon.tech", "EP-STATE-POOLER.us-east-1.aws.NEON.TECH."],
    (host) =>
      stateFailure({
        ALCHEMY_STATE_DATABASE_URL: `postgresql://state:private-password@${host}/alchemy?sslmode=require`,
      }).pipe(
        Effect.map((error) => {
          expect(error).toContain("transaction pooling");
          expect(error).toContain("direct or session-capable");
          expect(error).not.toContain("private-password");
        }),
      ),
  ),
);

it.effect("rejects malformed and non-Postgres URLs without echoing their values", () =>
  Effect.forEach(
    ["private-password", "https://state:private-password@example.com/alchemy"],
    (url) =>
      stateFailure({ ALCHEMY_STATE_DATABASE_URL: url }).pipe(
        Effect.map((error) => {
          expect(error).toContain("Postgres connection URL");
          expect(error).not.toContain("private-password");
        }),
      ),
  ),
);

function stateFailure(
  config: Readonly<Record<string, string | undefined>>,
): Effect.Effect<string, never, never> {
  return selectedState(false, config).pipe(
    Effect.matchCause({
      onFailure: Cause.pretty,
      onSuccess: () => {
        throw new Error("Expected state configuration to fail");
      },
    }),
  );
}

function selectedState(
  dev: boolean,
  config: Readonly<Record<string, string | undefined>>,
): Effect.Effect<import("alchemy/State").StateService, never, never> {
  return State.pipe(
    Effect.flatten,
    Effect.provide(deploymentState),
    Effect.provideService(AlchemyContext, { dev, adopt: false, dotAlchemy: ".alchemy" }),
    Effect.provide(NodeServices.layer),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(config))),
  );
}
