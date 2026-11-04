import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";

export function Badge(props: BadgeProps): JSX.Element {
  return (
    <span
      class={cx(
        "inline-flex items-center text-label leading-none font-semibold uppercase tracking-label",
        props.tone === "accent" ? "text-action" : "text-ink-faint",
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
