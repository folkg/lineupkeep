import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function SeasonArea(props: {
  readonly children?: Element;
  readonly detail?: boolean;
  readonly loading?: boolean;
}): JSX.Element {
  return (
    <div
      class={
        props.loading === true
          ? props.detail === true
            ? "min-h-[43.5rem] sm:min-h-[39rem]"
            : "min-h-[16rem] sm:min-h-[14.75rem]"
          : undefined
      }
    >
      {props.children}
    </div>
  );
}
