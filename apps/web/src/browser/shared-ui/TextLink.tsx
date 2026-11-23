import type { JSX } from "@solidjs/web";
import { useLinkProps } from "@tanstack/solid-router";
import type { LinkComponentProps } from "@tanstack/solid-router";
import { omit } from "solid-js";
import type { Element } from "solid-js";

import { cx } from "./cx";
import { typeClass } from "./type";
import type { TextType } from "./type";

export function TextLink(props: TextLinkProps): JSX.Element {
  const rest = omit(props, "type", "tone", "children", "leadingIcon");
  const linkProps = useLinkProps(rest);
  return (
    <a
      {...linkProps}
      class={cx(
        "justify-self-start focus-visible:outline-none focus-visible:shadow-focus",
        props.leadingIcon !== undefined && "inline-flex items-center gap-1.5",
        props.type === "card-title"
          ? cx("break-words text-ink hover:text-action", typeClass["card-title"])
          : cx(
              "underline decoration-2 underline-offset-4",
              typeClass[props.type ?? "body-strong"],
              props.tone === "quiet"
                ? "text-ink-soft hover:text-ink"
                : "text-action hover:text-action-hover",
            ),
      )}
    >
      {props.leadingIcon}
      {props.children}
    </a>
  );
}

type TextLinkProps = Omit<LinkComponentProps<"a">, "class" | "style" | "type" | "children"> & {
  readonly type?: Extract<TextType, "card-title" | "body-strong" | "meta">;
  readonly tone?: "action" | "quiet";
  readonly leadingIcon?: Element;
  readonly children: Element;
};
