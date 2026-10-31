import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";
import { gapClass } from "./space";
import type { Space } from "./space";

export function Inline(props: InlineProps): JSX.Element {
  return (
    <div
      class={cx(
        "flex flex-wrap",
        gapClass[props.gap],
        props.align === "start"
          ? "items-start"
          : props.align === "baseline"
            ? "items-baseline"
            : "items-center",
        props.justify === "between" && "justify-between",
        props.collapse === true && "max-sm:grid max-sm:[&>*]:w-full",
      )}
    >
      {props.children}
    </div>
  );
}

type InlineProps = {
  readonly gap: Space;
  readonly align?: "start" | "baseline";
  readonly justify?: "between";
  readonly collapse?: boolean;
  readonly children: Element;
};
