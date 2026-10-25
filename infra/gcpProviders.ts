import * as GCP from "alchemy/GCP";
import { Effect, Layer } from "effect";

const credentialsWithQuotaProject = Layer.effect(
  GCP.Credentials,
  Effect.gen(function* () {
    const resolve = yield* GCP.Credentials;
    return Effect.map(resolve, (config) => ({ ...config, quotaProject: config.project }));
  }),
).pipe(Layer.provide(GCP.providers()));

const environment = Layer.effect(
  GCP.GcpEnvironment,
  Effect.map(GCP.Credentials, (resolve) =>
    Effect.gen(function* () {
      const config = yield* resolve.pipe(Effect.orDie);
      if (config.project === undefined) {
        return yield* Effect.die(new Error("GCP project id is required"));
      }
      return {
        accessToken: config.accessToken,
        project: config.project,
        region: config.region ?? "us-central1",
      };
    }),
  ),
).pipe(Layer.provide(credentialsWithQuotaProject));

export const gcpProviders = Layer.mergeAll(
  Layer.effect(GCP.Providers)(GCP.Providers.pipe(Effect.provide(GCP.providers()))),
  credentialsWithQuotaProject,
  environment,
);
