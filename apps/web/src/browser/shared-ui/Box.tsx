import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";
import type { Space } from "./space";

export function Box(props: BoxProps): JSX.Element {
  return (
    <div
      class={cx(
        props.rule === "top" ? "border-t" : "border-b",
        props.ruleTone === "ink" ? "border-ink" : "border-rule-strong",
        props.rule === "top" ? paddingTop[props.space] : paddingBottom[props.space],
      )}
    >
      {props.children}
    </div>
  );
}

const paddingTop: Record<Space, string> = {
  none: "pt-0",
  "2xs": "pt-0.5",
  xs: "pt-1",
  sm: "pt-2",
  md: "pt-3",
  lg: "pt-4",
  xl: "pt-6",
  "2xl": "pt-8",
};

const paddingBottom: Record<Space, string> = {
  none: "pb-0",
  "2xs": "pb-0.5",
  xs: "pb-1",
  sm: "pb-2",
  md: "pb-3",
  lg: "pb-4",
  xl: "pb-6",
  "2xl": "pb-8",
};

type BoxProps = {
  readonly rule: "top" | "bottom";
  readonly ruleTone?: "strong" | "ink";
  readonly space: Space;
  readonly children: Element;
};
