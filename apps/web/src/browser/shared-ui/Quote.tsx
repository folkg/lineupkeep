import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function Quote(props: QuoteProps): JSX.Element {
  return (
    <blockquote class="grid max-w-[42.5rem] gap-2 border-l border-rule ps-4">
      <p class="text-label font-semibold uppercase tracking-label text-ink-faint">{props.label}</p>
      {props.children}
    </blockquote>
  );
}

type QuoteProps = {
  readonly label: string;
  readonly children: Element;
};
