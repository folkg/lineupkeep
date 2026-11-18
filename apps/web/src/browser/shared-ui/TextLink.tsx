import type { JSX } from "@solidjs/web";
import { createLink } from "@tanstack/solid-router";
import { omit } from "solid-js";

import { cx } from "./cx";
import { typeClass } from "./type";
import type { TextType } from "./type";

export const TextLink = createLink(TextAnchor);

function TextAnchor(props: TextAnchorProps): JSX.Element {
  const rest = omit(props, "type", "tone", "children");
  return (
    <a
      {...rest}
      class={cx(
        "justify-self-start focus-visible:outline-none focus-visible:shadow-focus",
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
      {props.children}
    </a>
  );
}

type TextAnchorProps = Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "class" | "type"> & {
  readonly type?: Extract<TextType, "card-title" | "body-strong" | "meta">;
  readonly tone?: "action" | "quiet";
};
