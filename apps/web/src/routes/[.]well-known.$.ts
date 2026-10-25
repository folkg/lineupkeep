import { createFileRoute } from "@tanstack/solid-router";

import { handleAuthRequest } from "#server/auth/authServer.ts";

export const Route = createFileRoute("/.well-known/$")({
  server: {
    handlers: {
      GET: ({ request }) => handleAuthRequest(request),
      HEAD: ({ request }) => handleAuthRequest(request),
    },
  },
});
