import { createFileRoute } from "@tanstack/solid-router";

import { handleAccountExportRequest } from "#server/account/accountExport.ts";

export const Route = createFileRoute("/api/account/export")({
  server: {
    handlers: {
      GET: ({ request }) => handleAccountExportRequest(request),
    },
  },
});
