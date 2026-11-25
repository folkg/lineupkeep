import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";
import { typeClass } from "./type";
import type { TextType } from "./type";

export function ExternalTextLink(props: ExternalTextLinkProps): JSX.Element {
  return (
    <a
      aria-label={props.label}
      class={cx(
        "justify-self-start underline decoration-2 underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus",
        props.trailingIcon === undefined ? undefined : "inline-flex items-center gap-1.5",
        typeClass[props.type ?? "meta"],
        props.tone === "quiet"
          ? "text-ink-soft hover:text-ink"
          : "text-action hover:text-action-hover",
      )}
      href={props.href}
      rel="noreferrer"
      target="_blank"
      title={props.label}
    >
      {props.children}
      {props.trailingIcon}
    </a>
  );
}

type ExternalTextLinkProps = {
  readonly href: string;
  readonly label: string;
  readonly children: Element;
  readonly type?: Extract<TextType, "body-strong" | "meta">;
  readonly tone?: "action" | "quiet";
  readonly trailingIcon?: Element;
};
