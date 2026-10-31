import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";

export function Split(props: SplitProps): JSX.Element {
  return (
    <div class={cx("grid gap-3", props.columns === 2 && "sm:grid-cols-2")}>{props.children}</div>
  );
}

type SplitProps = {
  readonly columns?: 2;
  readonly children: Element;
};
