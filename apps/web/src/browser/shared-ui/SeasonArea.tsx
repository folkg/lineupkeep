import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function SeasonArea(props: {
  readonly children?: Element;
  readonly detail?: boolean;
}): JSX.Element {
  return (
    <div
      class={
        props.detail === true ? "min-h-[36rem] sm:min-h-[25rem]" : "min-h-[30.5rem] sm:min-h-60"
      }
    >
      {props.children}
    </div>
  );
}
