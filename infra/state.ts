import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { postgresState } from "alchemy/State/PostgresState";
import { Config, Effect, Layer, Redacted } from "effect";

export const deploymentState = Layer.unwrap(
  Effect.gen(function* () {
    if ((yield* AlchemyContext).dev) {
      return Alchemy.localState();
    }
    const url = yield* Config.Redacted("ALCHEMY_STATE_DATABASE_URL").pipe(
      Effect.mapError(
        () =>
          new Error(
            "ALCHEMY_STATE_DATABASE_URL is required for non-local plan, deploy and destroy. Bootstrap the dedicated state database; local state is never a fallback.",
          ),
      ),
    );
    yield* validateStateUrl(url);

    return postgresState({ url });
  }),
).pipe(Layer.orDie);

function validateStateUrl(
  value: Redacted.Redacted<string>,
): Effect.Effect<undefined, Error, never> {
  return Effect.gen(function* () {
    const invalid = (): Error =>
      new Error("ALCHEMY_STATE_DATABASE_URL must be a valid Postgres connection URL.");
    const url = yield* Effect.try({
      try: () => new URL(Redacted.value(value)),
      catch: invalid,
    });
    if (!["postgres:", "postgresql:"].includes(url.protocol) || url.hostname === "") {
      return yield* Effect.fail(invalid());
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
    if (hostname.endsWith(".neon.tech") && hostname.split(".")[0]?.endsWith("-pooler") === true) {
      return yield* Effect.fail(
        new Error(
          "ALCHEMY_STATE_DATABASE_URL cannot use Neon transaction pooling. Use a direct or session-capable endpoint with at least two connections for state lock verification.",
        ),
      );
    }
  });
}
