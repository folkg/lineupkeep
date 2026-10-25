import * as Output from "alchemy/Output";
import { Config, Effect, Layer } from "effect";

import { DatabaseDeployment } from "#infra/services/DatabaseDeployment.ts";

export const externalDatabase = Layer.effect(DatabaseDeployment)(
  Effect.gen(function* () {
    const runtimeUrl = yield* Config.Redacted("DATABASE_URL");
    const directUrl = yield* Config.Redacted("DATABASE_DIRECT_URL");
    return {
      runtimeUrl: Output.asOutput(runtimeUrl),
      directUrl: Output.asOutput(directUrl),
    };
  }),
);
