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
            ? "min-h-[26rem] min-[560px]:min-h-[24rem]"
            : undefined
          : undefined
      }
    >
      {props.children}
    </div>
  );
}
