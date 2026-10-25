import { createFileRoute } from "@tanstack/solid-router";

import { handleLineupWorkerRequest } from "#server/lineupWorker.ts";

export const Route = createFileRoute("/api/internal/lineup-worker")({
  server: {
    handlers: {
      POST: ({ request }) => handleLineupWorkerRequest(request),
    },
  },
});
