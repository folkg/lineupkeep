import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { iconButtonClass } from "./Button";

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
      {props.children}
    </a>
  );
}

type IconLinkProps = {
  readonly href: string;
  readonly label: string;
  readonly title?: string;
  readonly children: Element;
};
