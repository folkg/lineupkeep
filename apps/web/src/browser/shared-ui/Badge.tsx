import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";
import { typeClass } from "./type";

export function Badge(props: BadgeProps): JSX.Element {
  return (
    <span
      class={cx(
        "inline-flex items-center border-2 border-rule-strong bg-paper px-2 py-1 uppercase",
        typeClass.badge,
        props.tone === "accent" ? "text-action" : "text-ink-soft",
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
