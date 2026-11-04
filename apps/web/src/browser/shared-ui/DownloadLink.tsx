import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { buttonClass } from "./Button";
import { cx } from "./cx";

export function DownloadLink(props: DownloadLinkProps): JSX.Element {
  return (
    <a
      class={cx(buttonClass({ variant: "secondary" }), "justify-self-start")}
      download
      href={props.href}
    >
      {props.children}
    </a>
  );
}

type DownloadLinkProps = {
  readonly href: string;
  readonly children: Element;
};
