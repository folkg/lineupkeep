import { createFileRoute } from "@tanstack/solid-router";

import { connectionsRedirect } from "#browser/navigation/connectionsRedirect.ts";

export const Route = createFileRoute("/connections")({
  beforeLoad: () => connectionsRedirect(),
});
