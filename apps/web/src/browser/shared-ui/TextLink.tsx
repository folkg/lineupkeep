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
        props.size === "team"
          ? "break-words font-display text-team-name font-extrabold tracking-tight text-ink hover:text-action"
          : cx(
              "underline decoration-2 underline-offset-4",
              props.size === "caption" ? "text-caption" : "text-body",
              "font-semibold",
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

type TextAnchorProps = Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "class"> & {
  readonly size?: "control" | "team" | "caption";
  readonly tone?: "action" | "quiet";
};
