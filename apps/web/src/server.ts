import { correlateRequestEffect } from "@lineupkeep/backend/runtime/RequestContext";
import { EffectString } from "@lineupkeep/collections";
import { createStartHandler, defaultStreamHandler } from "@tanstack/solid-start/server";
import { createServerEntry } from "@tanstack/solid-start/server-entry";
import { Config, Effect, Option } from "effect";

import { deploymentTarget } from "#deployment-target";
import { verificationRoute } from "#verification-route";

import { correlateResponse } from "./server/backendEntry.ts";
import { canonicalHostRedirect } from "./server/canonicalHost.ts";
import { installServerTelemetry } from "./server/telemetry/telemetryServer.ts";
import { renderWakingShell } from "./server/wakingShell.ts";

const canonicalAuthUrl = Effect.runSync(Config.option(Config.String("BETTER_AUTH_URL")));
deploymentTarget.install();
installServerTelemetry();

const startHandler = createStartHandler(defaultStreamHandler);

const defaultWakingShellDeadlineMs = 2_000;
const teamWakingShellDeadlineMs = 6_000;
const transactionWakingShellDeadlineMs = 6_000;

export default createServerEntry({
  fetch: (request, startOptions) => {
    const canonical = Option.getOrUndefined(canonicalAuthUrl);
    const redirect =
      canonical === undefined ? undefined : canonicalHostRedirect(request, canonical);
    if (redirect !== undefined) {
      return Promise.resolve(redirect);
    }
    return Effect.runPromise(correlateRequestEffect(request)).then((correlated) =>
      deploymentTarget.backend
        .runHttpHandler(correlated.request, (request) =>
          renderWakingShell(request, {
            deadlineMs: EffectString.startsWith(new URL(request.url).pathname, "/transactions")
              ? transactionWakingShellDeadlineMs
              : EffectString.startsWith(new URL(request.url).pathname, "/teams")
                ? teamWakingShellDeadlineMs
                : defaultWakingShellDeadlineMs,
            render: (request) =>
              verificationRoute(request).then(
                (response) => response ?? startHandler(request, startOptions),
              ),
          }),
        )
        .then((response) => correlateResponse(response, correlated.requestId)),
    );
  },
});
