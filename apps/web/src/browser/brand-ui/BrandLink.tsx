import type { JSX } from "@solidjs/web";
import { createLink } from "@tanstack/solid-router";
import { omit } from "solid-js";

import { typeClass } from "#browser/shared-ui/type.ts";

import { BrandMark } from "./BrandMark";

export const BrandLink = createLink(BrandAnchor);

function BrandAnchor(props: JSX.AnchorHTMLAttributes<HTMLAnchorElement>): JSX.Element {
  const rest = omit(props, "children", "class");
  return (
    <a
      {...rest}
      class={`inline-flex min-h-tap-target items-center gap-2.5 text-ink lowercase no-underline focus-visible:outline-none focus-visible:shadow-focus ${typeClass.label}`}
    >
      <BrandMark />
      <span>{props.children}</span>
    </a>
  );
}
