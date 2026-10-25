import * as Neon from "alchemy/Neon";
import * as Output from "alchemy/Output";
import { Effect, Layer, Redacted } from "effect";

import { DatabaseDeployment } from "#infra/services/DatabaseDeployment.ts";

export const neonDatabase = Layer.effect(DatabaseDeployment)(
  Effect.gen(function* () {
    const database = yield* Neon.Project.ref("Postgres", {
      stack: "SourdoughStarterDatabase",
      stage: "production",
    });
    return {
      runtimeUrl: Output.map(database.pooledConnectionUri, Redacted.make),
      directUrl: Output.map(database.connectionUri, Redacted.make),
    };
  }),
);
