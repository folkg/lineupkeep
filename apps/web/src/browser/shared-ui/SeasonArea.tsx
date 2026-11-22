import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function SeasonArea(props: { readonly children?: Element }): JSX.Element {
  return <div class="min-h-[30.5rem] sm:min-h-60">{props.children}</div>;
}
