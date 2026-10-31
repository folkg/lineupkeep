import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";

export function Badge(props: BadgeProps): JSX.Element {
  return (
    <span
      class={cx(
        "inline-flex items-center rounded-badge px-2 py-1 text-metadata font-semibold",
        props.tone === "accent"
          ? "bg-accent text-on-accent"
          : "border border-rule-strong text-ink-soft",
      )}
    >
      {props.children}
    </span>
  );
}

type BadgeProps = {
  readonly tone?: "accent" | "neutral";
  readonly children: Element;
};
