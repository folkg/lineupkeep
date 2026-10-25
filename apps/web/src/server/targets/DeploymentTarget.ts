import type { BackendRuntime } from "@lineupkeep/backend/runtime/BackendRuntime";

import type { HostedBrowserFactory } from "#server/hostedLinking/HostedBrowser.ts";

export type DeploymentTarget = {
  readonly backend: BackendRuntime;

  readonly hostedBrowser?: HostedBrowserFactory;

  readonly install: () => void;
};
