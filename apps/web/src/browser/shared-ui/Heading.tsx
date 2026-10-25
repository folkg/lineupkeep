import type { JSX } from "@solidjs/web";
import { dynamic } from "@solidjs/web";
import type { Element } from "solid-js";

export function Heading(props: HeadingProps): JSX.Element {
  const Tag = dynamic(() => `h${props.level}` as const);
  return (
    <Tag
      ref={props.ref}
      id={props.id}
      tabindex={props.focusable === true ? -1 : undefined}
      class={sizeClass[props.size]}
    >
      {props.children}
    </Tag>
  );
}

const sizeClass = {
  display: "max-w-[14ch] text-balance font-display text-display font-semibold",

  statement: "max-w-[14ch] text-balance font-display text-statement font-semibold",
  headline: "font-display text-headline font-semibold",
  title: "font-display text-title font-semibold",
  subtitle: "font-display text-subtitle font-semibold",
  section: "font-display text-section-title font-semibold",
  item: "break-words text-item font-bold",
};

type HeadingProps = {
  readonly level: 1 | 2 | 3;
  readonly size: keyof typeof sizeClass;
  readonly id?: string;
  readonly ref?: (element: HTMLHeadingElement) => void;

  readonly focusable?: boolean;
  readonly children: Element;
};
