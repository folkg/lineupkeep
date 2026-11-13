import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function ResponsiveContent(props: {
  readonly phone: Element;
  readonly wide: Element;
}): JSX.Element {
  return (
    <>
      <span class="sm:hidden">{props.phone}</span>
      <span class="max-sm:hidden">{props.wide}</span>
    </>
  );
}
