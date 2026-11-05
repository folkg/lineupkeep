import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";

export function RuleList(props: { readonly children: Element }): JSX.Element {
  return <ol class="w-full">{props.children}</ol>;
}

export function RuleListItem(props: {
  readonly children: Element;
  readonly layout?: "stack" | "columns" | "leading";
  readonly dense?: boolean;
}): JSX.Element {
  return (
    <li
      class={cx(
        "grid gap-3 border-b border-rule",
        props.dense === true ? "py-3" : "py-4",
        props.dense !== true &&
          (props.layout === "columns" || props.layout === "leading") &&
          "md:py-5",
        props.layout === "columns" &&
          "min-[560px]:grid-cols-[minmax(0,1fr)_9rem] min-[560px]:items-start min-[560px]:gap-x-4",
        props.layout === "leading" && "md:grid-cols-[8.5rem_minmax(0,1fr)] md:items-start md:gap-6",
      )}
    >
      {props.children}
    </li>
  );
}
