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
  display: "max-w-[8.5ch] font-display text-display font-bold",

  statement: "font-display text-statement font-bold max-md:text-balance md:max-w-[8.5ch]",
  headline: "font-display text-headline font-bold",
  title: "font-display text-title font-bold",
  subtitle: "font-display text-subtitle font-bold",
  section: "font-display text-section-title font-bold",
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
