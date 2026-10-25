import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
import * as Docker from "alchemy/Docker";
import * as GCP from "alchemy/GCP";
import * as Secrets from "alchemy/Secrets";
import { Stage } from "alchemy/Stage";
import { Effect, Layer } from "effect";

import { applicationConfig } from "./config.ts";
import { postgresProvider } from "./local/Postgres.ts";
import { migrate } from "./migrations.ts";
import { DatabaseDeployment } from "./services/DatabaseDeployment.ts";
import { HostDeployment } from "./services/HostDeployment.ts";
import { assertLocalStage, databaseLayer, hostLayer, stageSpec } from "./stage.ts";
import { deploymentState } from "./state.ts";

export const localProviders = Layer.mergeAll(
  Cloudflare.providers(),
  Command.providers(),
  Docker.providers(),
  postgresProvider,
);
const providers = Layer.mergeAll(
  localProviders,
  Layer.effect(GCP.Providers)(GCP.Providers.pipe(Effect.provide(GCP.providers()))),
);

export default Alchemy.Stack(
  "SourdoughStarterWeb",
  {
    providers,
    state: deploymentState,
    secrets: Secrets.ProcessEnv(),
  },
  Effect.gen(function* () {
    const stage = stageSpec(yield* Stage);
    assertLocalStage(stage, (yield* AlchemyContext).dev);
    const database = yield* DatabaseDeployment.pipe(Effect.provide(databaseLayer(stage)));
    const migrated = yield* migrate(database);
    const environment = { ...(yield* applicationConfig), DATABASE_URL: migrated.runtimeUrl };
    const application = yield* HostDeployment.pipe(
      Effect.provide(hostLayer(stage, migrated, environment)),
    );
    return application;
  }),
);
