import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function FocusRegion(props: {
  readonly id: string;
  readonly labelledBy?: string;
  readonly children: Element;
}): JSX.Element {
  return (
    <div
      id={props.id}
      class="scroll-mt-4 focus:outline-none"
      tabindex={-1}
      aria-labelledby={props.labelledBy}
    >
      {props.children}
    </div>
  );
}
