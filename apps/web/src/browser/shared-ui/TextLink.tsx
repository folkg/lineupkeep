import type { JSX } from "@solidjs/web";
import { createLink } from "@tanstack/solid-router";
import { omit } from "solid-js";

import { cx } from "./cx";

export const TextLink = createLink(TextAnchor);

function TextAnchor(props: TextAnchorProps): JSX.Element {
  const rest = omit(props, "size", "children");
  return (
    <a
      {...rest}
      class={cx(
        "justify-self-start font-semibold text-action underline decoration-1 underline-offset-4 hover:text-action-hover focus-visible:outline-none focus-visible:shadow-focus",
        props.size === "item" ? "text-item font-bold" : "text-control",
      )}
    >
      {props.children}
    </a>
  );
}

type TextAnchorProps = Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "class"> & {
  readonly size?: "control" | "item";
};
