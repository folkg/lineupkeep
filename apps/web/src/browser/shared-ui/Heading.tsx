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
  display: "max-w-[19ch] text-balance font-display text-display font-extrabold tracking-display",
  statement: "max-w-[22ch] text-balance font-display text-statement font-extrabold tracking-tight",
  page: "max-w-[28ch] text-balance font-display text-page-title font-extrabold uppercase tracking-display",
  name: "break-words font-display text-team-name font-extrabold tracking-tight",
  headline: "max-w-[28ch] text-balance font-display text-headline font-extrabold tracking-tight",
  title: "text-pretty font-display text-title font-extrabold tracking-tight",
  subtitle: "text-pretty font-display text-subtitle font-extrabold tracking-tight",
  section: "text-pretty font-display text-section-title font-extrabold tracking-tight",
  item: "break-words text-item font-semibold",
};

type HeadingProps = {
  readonly level: 1 | 2 | 3 | 4;
  readonly size: keyof typeof sizeClass;
  readonly id?: string;
  readonly ref?: (element: HTMLHeadingElement) => void;

  readonly focusable?: boolean;
  readonly children: Element;
};
