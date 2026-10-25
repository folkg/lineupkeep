import type { BackendRuntime } from "@sourdough/backend/runtime/BackendRuntime";

export type DeploymentTarget = {
  readonly backend: BackendRuntime;

  readonly install: () => void;
};
