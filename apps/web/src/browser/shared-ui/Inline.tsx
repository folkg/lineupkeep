import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";
import { gapClass } from "./space";
import type { Space } from "./space";

export function Inline(props: InlineProps): JSX.Element {
  return (
    <div
      class={cx(
        "flex",
        props.nowrap === true ? "flex-nowrap" : "flex-wrap",
        gapClass[props.gap],
        props.align === "start"
          ? "items-start"
          : props.align === "baseline"
            ? "items-baseline"
            : "items-center",
        props.justify === "between" && "justify-between",
        props.justify === "end" && "justify-end max-[559px]:justify-start",
        props.growFirst === true && "[&>*:first-child]:min-w-0 [&>*:first-child]:flex-1",
        props.fullWidthOnSmall === true &&
          "max-[559px]:col-span-2 max-[559px]:w-full max-[559px]:justify-start",
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
  readonly justify?: "between" | "end";
  readonly fullWidthOnSmall?: boolean;
  readonly nowrap?: boolean;
  readonly growFirst?: boolean;
  readonly collapse?: boolean;
  readonly children: Element;
};
