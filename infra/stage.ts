import type { Config, Layer } from "effect";

import { externalDatabase } from "./database/external.ts";
import { localPostgres } from "./database/localPostgres.ts";
import { neonDatabase } from "./database/neon.ts";
import { cloudflareHost } from "./hosts/cloudflare.ts";
import { cloudRunHost } from "./hosts/cloudRun.ts";
import { localContainerHost } from "./hosts/localContainer.ts";
import { localNodeHost } from "./hosts/localNode.ts";
import { developmentDatabaseLayer } from "./local/developmentDatabase.ts";
import type { DatabaseDeployment, DatabaseOutputs } from "./services/DatabaseDeployment.ts";
import type {
  HostDeployment,
  HostEnvironment,
  LocalHostOptions,
} from "./services/HostDeployment.ts";

export function stageSpec(name: string): StageSpec {
  switch (name) {
    case "development":
      return { name, host: "local", database: "development" };
    case "development-cloudflare":
      return { name, host: "cloudflare", database: "development" };
    case "local":
      return { name, host: "local", database: "local" };
    case "local-container":
      return { name, host: "container", database: "local" };
    case "local-cloudflare":
      return { name, host: "cloudflare", database: "local" };
    case "production":
      return { name, host: "cloudflare", database: "neon" };
    case "cloud-run":
      return { name, host: "cloud-run", database: "neon" };
    case "local-external-db":
      return { name, host: "local", database: "external" };
    default:
      throw new Error(`Unknown stage "${name}". Add an explicit stage policy in infra/stage.ts.`);
  }
}

export function databaseLayer(
  stage: StageSpec,
): Layer.Layer<
  DatabaseDeployment,
  Config.ConfigError,
  Layer.Services<ReturnType<typeof localPostgres>>
> {
  switch (stage.database) {
    case "development":
      return developmentDatabaseLayer;
    case "local":
      return localPostgres(stage.name);
    case "external":
      return externalDatabase;
    case "neon":
      return neonDatabase;
  }
}

export function hostLayer(
  stage: StageSpec,
  migrated: DatabaseOutputs,
  environment: HostEnvironment,
  options: LocalHostOptions = {},
): Layer.Layer<HostDeployment, Config.ConfigError, HostRequirements> {
  switch (stage.host) {
    case "local":
      return localNodeHost(environment, options);
    case "container":
      return localContainerHost(environment, options);
    case "cloudflare":
      return cloudflareHost(
        migrated,
        stage.database === "local" || stage.database === "development",
        environment,
        options,
      );
    case "cloud-run":
      return cloudRunHost(environment);
  }
}

export function assertLocalStage(stage: StageSpec, local: boolean): void {
  if (local && (stage.database === "neon" || stage.host === "cloud-run")) {
    throw new Error(
      "Local mode requires a local/external database and a local Node/Cloudflare host",
    );
  }
}

export function assertVerificationStage(stage: string, runId: string, databaseName: string): void {
  if (
    !stage.startsWith("verify-") ||
    databaseName !== `lineupkeep-test-${runId.replaceAll("-", "")}`
  ) {
    throw new Error("Verification requires a verify stage and its disposable run-owned database");
  }
}

export type StageSpec = {
  readonly name: string;
  readonly host: "local" | "container" | "cloudflare" | "cloud-run";
  readonly database: "local" | "external" | "neon" | "development";
};

type HostRequirements = Layer.Services<
  | ReturnType<typeof localContainerHost>
  | ReturnType<typeof localNodeHost>
  | ReturnType<typeof cloudflareHost>
  | ReturnType<typeof cloudRunHost>
>;
