import type { JSX } from "@solidjs/web";
import { createLink } from "@tanstack/solid-router";
import { omit } from "solid-js";

import { cx } from "./cx";

export const TextLink = createLink(TextAnchor);

function TextAnchor(props: TextAnchorProps): JSX.Element {
  const rest = omit(props, "size", "tone", "children");
  return (
    <a
      {...rest}
      class={cx(
        "justify-self-start focus-visible:outline-none focus-visible:shadow-focus",
        props.size === "item"
          ? "break-words font-display text-section-title font-semibold text-ink hover:text-action"
          : props.tone === "quiet"
            ? "text-body font-semibold text-ink-soft underline decoration-1 underline-offset-4 hover:text-ink"
            : "text-body font-semibold text-action underline decoration-1 underline-offset-4 hover:text-action-hover",
      )}
    >
      {props.children}
    </a>
  );
}

type TextAnchorProps = Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "class"> & {
  readonly size?: "control" | "item";
  readonly tone?: "action" | "quiet";
};
