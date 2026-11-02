import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { buttonClass } from "./Button";

export function DownloadLink(props: DownloadLinkProps): JSX.Element {
  return (
    <a class={buttonClass({ variant: "secondary" })} download href={props.href}>
      {props.children}
    </a>
  );
}

type DownloadLinkProps = {
  readonly href: string;
  readonly children: Element;
};
