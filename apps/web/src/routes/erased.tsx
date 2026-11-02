import type { JSX } from "@solidjs/web";
import { createFileRoute } from "@tanstack/solid-router";

import { AccountErasedPage } from "#browser/account/AccountErasedPage.tsx";

export const Route = createFileRoute("/erased")({
  ssr: true,
  component: ErasedRoute,
});

function ErasedRoute(): JSX.Element {
  return <AccountErasedPage />;
}
