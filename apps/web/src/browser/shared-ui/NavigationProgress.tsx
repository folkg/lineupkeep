import type { JSX } from "@solidjs/web";
import { useRouterState } from "@tanstack/solid-router";
import { Show } from "solid-js";

export function NavigationProgress(): JSX.Element {
  const pending = useRouterState({ select: (state) => state.status === "pending" });
  return (
    <Show when={pending()}>
      <div
        aria-label="Loading page"
        class="fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden bg-rule"
        role="progressbar"
      >
        <div class="h-full w-1/3 animate-navigation-progress bg-action" />
      </div>
    </Show>
  );
}
