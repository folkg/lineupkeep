import type { JSX } from "@solidjs/web";
import { dynamic } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";
import { typeClass } from "./type";
import type { TextType } from "./type";

export function Heading(props: HeadingProps): JSX.Element {
  const Tag = dynamic(() => `h${props.level}` as const);
  return (
    <Tag
      ref={props.ref}
      id={props.id}
      tabindex={props.focusable === true ? -1 : undefined}
      class={cx(layoutClass[props.type], typeClass[props.type])}
    >
      {props.children}
    </Tag>
  );
}

const layoutClass = {
  display: "max-w-[19ch] text-balance",
  "page-title": "max-w-[28ch] text-balance uppercase",
  "name-title": "text-pretty",
  "section-title": "text-pretty",
  "card-title": "break-words text-pretty",
  "body-strong": "break-words",
};

type HeadingProps = {
  readonly level: 1 | 2 | 3 | 4;
  readonly type: Extract<
    TextType,
    "display" | "page-title" | "name-title" | "section-title" | "card-title" | "body-strong"
  >;
  readonly id?: string;
  readonly ref?: (element: HTMLHeadingElement) => void;

  readonly focusable?: boolean;
  readonly children: Element;
};
