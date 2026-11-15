import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function Band(props: BandProps): JSX.Element {
  return (
    <section
      aria-labelledby={props.labelledBy}
      class="border-y border-t-action border-b-rule bg-action-soft px-4 py-6 sm:px-6"
    >
      {props.children}
    </section>
  );
}

type BandProps = {
  readonly labelledBy: string;
  readonly children: Element;
};
