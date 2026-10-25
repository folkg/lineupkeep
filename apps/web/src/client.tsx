import { hydrate } from "@solidjs/web";
import { StartClient, hydrateStart } from "@tanstack/solid-start/client";

import { installClientTelemetry } from "./browser/telemetry/telemetry";
import { telemetryRemote } from "./browser/telemetry/telemetryRemote";

if (import.meta.env.DEV) {
  await import("virtual:solid-diagnostics/client");
}

installClientTelemetry(telemetryRemote);

hydrateStart()
  .then((router) => {
    hydrate(() => <StartClient router={router} />, document);
  })
  .catch(console.error);
