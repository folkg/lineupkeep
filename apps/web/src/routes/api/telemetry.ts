import { createFileRoute } from "@tanstack/solid-router";

import { handleTelemetryRequest } from "#server/telemetry/telemetryServer.ts";

export const Route = createFileRoute("/api/telemetry")({
  server: {
    handlers: {
      POST: ({ request }) => handleTelemetryRequest(request),
    },
  },
});
