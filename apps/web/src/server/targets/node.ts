import { longRunningProcess } from "@lineupkeep/backend/runtime/BackendPlatform";

import { BackendRuntime } from "#backend-runtime";
import { playwrightHostedBrowser } from "#server/hostedLinking/playwrightHostedBrowser.ts";

import type { DeploymentTarget } from "./DeploymentTarget";

const backend = BackendRuntime.make(longRunningProcess());

export const deploymentTarget: DeploymentTarget = {
  backend,
  hostedBrowser: playwrightHostedBrowser,
  install: () => {
    process.once("SIGINT", stopProcess);
    process.once("SIGTERM", stopProcess);
  },
};

function stopProcess(): void {
  void deploymentTarget.hostedBrowser
    ?.closeAll()
    .catch(() => undefined)
    .then(() => backend.dispose())
    .then(
      () => process.exit(0),
      () => process.exit(1),
    );
}
