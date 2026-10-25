import { createFileRoute } from "@tanstack/solid-router";

import { handleLinkingHelperUpload } from "#server/linking/linkingUpload.ts";

export const Route = createFileRoute("/api/linking/complete")({
  server: {
    handlers: {
      POST: ({ request }) => handleLinkingHelperUpload(request),
    },
  },
});
