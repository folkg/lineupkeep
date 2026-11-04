import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { iconButtonClass, iconButtonFrameClass } from "./Button";

export function IconLink(props: IconLinkProps): JSX.Element {
  return (
    <a
      aria-label={props.label}
      class={iconButtonClass}
      href={props.href}
      rel="noreferrer"
      target="_blank"
      title={props.title ?? props.label}
    >
      <span aria-hidden="true" class={iconButtonFrameClass} />
      <span class="relative">{props.children}</span>
    </a>
  );
}

type IconLinkProps = {
  readonly href: string;
  readonly label: string;
  readonly title?: string;
  readonly children: Element;
};
