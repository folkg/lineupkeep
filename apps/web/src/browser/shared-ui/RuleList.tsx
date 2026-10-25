import type { JSX } from "@solidjs/web";
import { dynamic } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";

export function RuleList(props: { readonly children: Element }): JSX.Element {
  return <ol class="border-t border-rule-strong">{props.children}</ol>;
}

export function RuleListItem(props: {
  readonly children: Element;
  readonly layout?: "stack" | "columns";
}): JSX.Element {
  const Tag = dynamic(() => (props.layout === "columns" ? "li" : "li"));
  return (
    <Tag
      class={cx(
        "grid gap-2 border-b border-rule py-4",
        props.layout === "columns" &&
          "md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-8 md:py-5",
      )}
    >
      {props.children}
    </Tag>
  );
}
