import type { BackendRuntime } from "@lineupkeep/backend/runtime/BackendRuntime";

export type DeploymentTarget = {
  readonly backend: BackendRuntime;

  readonly install: () => void;
};
