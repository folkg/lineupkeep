import { createFileRoute } from "@tanstack/solid-router";

import { LandingPage } from "#browser/landing/LandingPage.tsx";

export const Route = createFileRoute("/")({
  component: LandingPage,
});
