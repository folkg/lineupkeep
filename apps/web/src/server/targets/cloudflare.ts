import { isolate } from "@lineupkeep/backend/runtime/BackendPlatform";
import { env, waitUntil } from "cloudflare:workers";

import { BackendRuntime } from "#backend-runtime";

import type { DeploymentTarget } from "./DeploymentTarget";

export const deploymentTarget: DeploymentTarget = {
  backend: BackendRuntime.make(
    isolate({ waitUntil, connectionString: () => env.HYPERDRIVE.connectionString }),
  ),
  install: () => undefined,
};
