import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function Quote(props: QuoteProps): JSX.Element {
  return (
    <blockquote class="grid max-w-[68ch] gap-1">
      <p class="text-metadata font-semibold text-ink-faint">{props.label}</p>
      {props.children}
    </blockquote>
  );
}

type QuoteProps = {
  readonly label: string;
  readonly children: Element;
};
