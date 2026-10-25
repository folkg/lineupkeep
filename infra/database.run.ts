import * as Alchemy from "alchemy";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Neon from "alchemy/Neon";
import * as Output from "alchemy/Output";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import * as Secrets from "alchemy/Secrets";
import { Effect, Redacted } from "effect";

import { deploymentState } from "./state.ts";

export default Alchemy.Stack(
  "SourdoughStarterDatabase",
  {
    providers: Neon.providers(),
    state: deploymentState,
    secrets: Secrets.ProcessEnv(),
  },
  Effect.gen(function* () {
    if ((yield* AlchemyContext).dev) {
      return yield* Effect.die(new Error("The durable Neon stack cannot run in local mode"));
    }
    const database = yield* Neon.Project("Postgres", {
      name: "sourdough-starter",
      pgVersion: 18,
      region: "aws-us-east-1",
      defaultBranchName: "production",
      databaseName: "sourdough_starter",
    }).pipe(RemovalPolicy.retain());
    return {
      runtimeUrl: Output.map(database.pooledConnectionUri, Redacted.make),
      directUrl: Output.map(database.connectionUri, Redacted.make),
      projectId: database.projectId,
    };
  }),
);
