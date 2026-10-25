import { createFileRoute } from "@tanstack/solid-router";

import { handleFakeProvider } from "#server/hostedLinking/fakeProvider.ts";

export const Route = createFileRoute("/api/dev/provider-login")({
  server: {
    handlers: {
      GET: ({ request }) => handleFakeProvider(request),
      POST: ({ request }) => handleFakeProvider(request),
    },
  },
});
