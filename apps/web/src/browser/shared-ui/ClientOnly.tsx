import type { JSX } from "@solidjs/web";
import { ClientOnly as RouterClientOnly } from "@tanstack/solid-router";

export function ClientOnly(props: {
  readonly children: JSX.Element;
  readonly fallback?: JSX.Element;
}): JSX.Element {
  return <RouterClientOnly fallback={props.fallback}>{props.children}</RouterClientOnly>;
}
