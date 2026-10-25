import { longRunningProcess } from "@lineupkeep/backend/runtime/BackendPlatform";

import { BackendRuntime } from "#backend-runtime";

import type { DeploymentTarget } from "./DeploymentTarget";

const backend = BackendRuntime.make(longRunningProcess());

export const deploymentTarget: DeploymentTarget = {
  backend,
  install: () => {
    process.once("SIGINT", stopProcess);
    process.once("SIGTERM", stopProcess);
  },
};

function stopProcess(): void {
  void backend.dispose().then(
    () => process.exit(0),
    () => process.exit(1),
  );
}
