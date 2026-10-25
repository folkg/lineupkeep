import { longRunningProcess } from "@lineupkeep/backend/runtime/BackendPlatform";

import { BackendRuntime } from "#backend-runtime";
import { cloudRunIdentityToken } from "#server/hostedLinking/cloudRunIdentity.ts";
import type { HostedBrowserFactory } from "#server/hostedLinking/HostedBrowser.ts";
import { playwrightHostedBrowser } from "#server/hostedLinking/playwrightHostedBrowser.ts";
import { createRemoteHostedBrowser } from "#server/hostedLinking/remoteHostedBrowser.ts";

import type { DeploymentTarget } from "./DeploymentTarget";

const backend = BackendRuntime.make(longRunningProcess());

export const deploymentTarget: DeploymentTarget = {
  backend,
  hostedBrowser: hostedBrowserFactory(),
  install: () => {
    process.once("SIGINT", stopProcess);
    process.once("SIGTERM", stopProcess);
  },
};

function hostedBrowserFactory(): HostedBrowserFactory {
  const url = process.env["HOSTED_BROWSER_URL"];
  if (url === undefined || url === "") {
    return playwrightHostedBrowser;
  }
  const descriptorKey = process.env["HOSTED_BROWSER_DESCRIPTOR_KEY"];
  if (descriptorKey === undefined || descriptorKey === "") {
    throw new Error("HOSTED_BROWSER_DESCRIPTOR_KEY is required when HOSTED_BROWSER_URL is set");
  }
  return createRemoteHostedBrowser({
    url,
    descriptorKey,
    identityToken: cloudRunIdentityToken,
  });
}

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
