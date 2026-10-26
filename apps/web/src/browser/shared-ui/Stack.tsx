import type { JSX } from "@solidjs/web";
import { dynamic } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";
import { gapClass } from "./space";
import type { Space } from "./space";

export function Stack(props: StackProps): JSX.Element {
  const Tag = dynamic(() => props.as ?? "div");
  return (
    <Tag
      id={props.id}
      hidden={props.hidden}
      aria-label={props.label}
      aria-labelledby={props.labelledBy}
      class={cx(
        "grid",
        gapClass[props.gap],
        props.align === "start" && "justify-items-start",
        props.measure === "control" && "max-w-[24rem]",
      )}
    >
      {props.children}
    </Tag>
  );
}

type StackProps = {
  readonly gap: Space;

  readonly align?: "start";
  readonly as?: "div" | "section";
  readonly id?: string;
  readonly hidden?: boolean;
  readonly label?: string;
  readonly labelledBy?: string;
  readonly measure?: "control";
  readonly children: Element;
};
