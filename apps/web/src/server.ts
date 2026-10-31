import { correlateRequestEffect } from "@lineupkeep/backend/runtime/RequestContext";
import { createStartHandler, defaultStreamHandler } from "@tanstack/solid-start/server";
import { createServerEntry } from "@tanstack/solid-start/server-entry";
import { Effect } from "effect";

import { deploymentTarget } from "#deployment-target";
import { verificationRoute } from "#verification-route";

import { correlateResponse } from "./server/backendEntry.ts";
import { installServerTelemetry } from "./server/telemetry/telemetryServer.ts";
import { renderWakingShell } from "./server/wakingShell.ts";
deploymentTarget.install();
installServerTelemetry();

const startHandler = createStartHandler(defaultStreamHandler);

const wakingShellDeadlineMs = 2_000;

export default createServerEntry({
  fetch: (request, startOptions) =>
    Effect.runPromise(correlateRequestEffect(request)).then((correlated) =>
      deploymentTarget.backend
        .runHttpHandler(correlated.request, (request) =>
          renderWakingShell(request, {
            deadlineMs: wakingShellDeadlineMs,
            render: (request) =>
              verificationRoute(request).then(
                (response) => response ?? startHandler(request, startOptions),
              ),
          }),
        )
        .then((response) => correlateResponse(response, correlated.requestId)),
    ),
});
