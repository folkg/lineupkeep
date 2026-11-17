import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";

export function RuleList(props: {
  readonly children: Element;
  readonly settling?: boolean;
  readonly surface?: "rules" | "cards";
}): JSX.Element {
  return (
    <ol
      class={props.surface === "cards" ? "grid w-full gap-4" : "w-full"}
      data-motion={props.settling === true ? "settle" : undefined}
    >
      {props.children}
    </ol>
  );
}

export function RuleListItem(props: {
  readonly children: Element;
  readonly layout?: "stack" | "columns" | "leading";
  readonly dense?: boolean;
  readonly leaving?: boolean;
  readonly surface?: "rule" | "card";
}): JSX.Element {
  const card = (): boolean => props.surface === "card";
  return (
    <li
      class={cx(
        "grid grid-rows-[1fr] transition-[grid-template-rows,opacity] duration-reveal ease-out-cubic",
        card() ? "border-2 border-rule-strong bg-paper" : "border-b border-rule",
        props.leaving === true && "grid-rows-[0fr] opacity-0",
      )}
    >
      <div
        class={cx(
          "grid min-h-0 gap-3",
          card() ? "px-4 py-4" : props.dense === true ? "py-3" : "py-4",
          !card() &&
            props.dense !== true &&
            (props.layout === "columns" || props.layout === "leading") &&
            "md:py-5",
          props.layout === "columns" &&
            "min-[560px]:grid-cols-[minmax(0,1fr)_9rem] min-[560px]:items-start min-[560px]:gap-x-4",
          props.layout === "leading" &&
            "md:grid-cols-[8.5rem_minmax(0,1fr)] md:items-start md:gap-6",
          props.leaving === true && "overflow-hidden",
        )}
      >
        {props.children}
      </div>
    </li>
  );
}
