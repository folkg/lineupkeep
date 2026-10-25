import type { JSX } from "@solidjs/web";
import { createLink } from "@tanstack/solid-router";
import { omit } from "solid-js";

export const BrandLink = createLink(BrandAnchor);

function BrandAnchor(props: JSX.AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element {
  const rest = omit(props, "children", "class");
  return (
    <a
      {...rest}
      class="inline-flex min-h-tap-target items-center rounded-control font-display text-wordmark font-medium text-ink lowercase no-underline focus-visible:outline-none focus-visible:shadow-focus"
    >
      {props.children}
    </a>
  );
}
