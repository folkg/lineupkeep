import type { JSX } from "@solidjs/web";
import { createLink } from "@tanstack/solid-router";
import { omit } from "solid-js";
import type { Element } from "solid-js";

import { iconButtonClass, iconButtonFrameClass } from "./Button";

export const IconNavLink = createLink(IconNavAnchor);

function IconNavAnchor(props: IconNavAnchorProps): JSX.Element {
  const rest = omit(props, "label", "children");
  return (
    <a
      {...rest}
      aria-label={props.label}
      class={iconButtonClass}
      title={props.title ?? props.label}
    >
      <span aria-hidden="true" class={iconButtonFrameClass} />
      <span class="relative">{props.children}</span>
    </a>
  );
}

type IconNavAnchorProps = Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "class"> & {
  readonly label: string;
  readonly title?: string;
  readonly children: Element;
};
