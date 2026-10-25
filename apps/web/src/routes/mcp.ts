import { createFileRoute } from "@tanstack/solid-router";

import { handleMcpRequest } from "#server/mcp/mcpServer.ts";

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => handleMcpRequest(request),
      POST: ({ request }) => handleMcpRequest(request),
      PUT: ({ request }) => handleMcpRequest(request),
      PATCH: ({ request }) => handleMcpRequest(request),
      DELETE: ({ request }) => handleMcpRequest(request),
      OPTIONS: ({ request }) => handleMcpRequest(request),
    },
  },
});
