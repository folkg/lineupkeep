import { hydrate } from "@solidjs/web";
import { QueryClient } from "@tanstack/solid-query";
import { StartClient, hydrateStart } from "@tanstack/solid-start/client";

import { persistTeamQueries, restoreTeamQueries } from "./browser/query/queryPersistence";
import { installClientTelemetry } from "./browser/telemetry/telemetry";
import { telemetryRemote } from "./browser/telemetry/telemetryRemote";

if (import.meta.env.DEV) {
  await import("virtual:solid-diagnostics/client");
}

installClientTelemetry(telemetryRemote);

hydrateStart()
  .then((router) => {
    const options: unknown = Reflect.get(router, "options");
    const context: unknown =
      typeof options === "object" && options !== null ? Reflect.get(options, "context") : undefined;
    const queryClient: unknown =
      typeof context === "object" && context !== null
        ? Reflect.get(context, "queryClient")
        : undefined;
    if (!(queryClient instanceof QueryClient)) {
      throw new Error("The client router did not provide a query client");
    }
    hydrate(() => <StartClient router={router} />, document);
    void restoreTeamQueries(queryClient).then(() => {
      persistTeamQueries(queryClient);
    });
  })
  .catch(console.error);
