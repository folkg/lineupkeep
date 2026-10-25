import { correlateRequestEffect } from "@sourdough/backend/runtime/RequestContext";
import { createStartHandler, defaultStreamHandler } from "@tanstack/solid-start/server";
import { createServerEntry } from "@tanstack/solid-start/server-entry";
import { Effect } from "effect";

import { deploymentTarget } from "#deployment-target";
import { verificationRoute } from "#verification-route";

import { correlateResponse } from "./server/backendEntry.ts";
import { installServerTelemetry } from "./server/telemetry/telemetryServer.ts";
deploymentTarget.install();
installServerTelemetry();

const startHandler = createStartHandler(defaultStreamHandler);

export default createServerEntry({
  fetch: (request, options) =>
    Effect.runPromise(correlateRequestEffect(request)).then((correlated) =>
      deploymentTarget.backend
        .runHttpHandler(correlated.request, (request) =>
          verificationRoute(request).then((response) => response ?? startHandler(request, options)),
        )
        .then((response) => correlateResponse(response, correlated.requestId)),
    ),
});
