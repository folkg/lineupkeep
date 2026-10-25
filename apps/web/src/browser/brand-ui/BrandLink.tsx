import type { JSX } from "@solidjs/web";
import { createLink } from "@tanstack/solid-router";
import { omit } from "solid-js";

import { Tape } from "./Tape";

export const BrandLink = createLink(BrandAnchor);

function BrandAnchor(props: BrandAnchorProps): JSX.Element {
  const rest = omit(props, "mark", "children", "class");
  return (
    <a
      {...rest}
      class="inline-flex min-h-tap-target items-center gap-2.5 text-base font-bold tracking-tight text-ink no-underline focus-visible:outline-none focus-visible:shadow-focus"
    >
      <Tape size="glyph">{props.mark}</Tape>
      <span>{props.children}</span>
    </a>
  );
}

type BrandAnchorProps = JSX.AnchorHTMLAttributes<HTMLAnchorElement> & {
  readonly mark: string;
};
