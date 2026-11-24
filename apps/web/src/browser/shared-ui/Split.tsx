import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function Split(props: SplitProps): JSX.Element {
  return (
    <div class="grid items-start gap-8 min-[640px]:grid-cols-[minmax(0,1fr)_13rem]">
      <div class="min-w-0 min-[640px]:order-2">{props.aside}</div>
      <div class="min-w-0 min-[640px]:order-1">{props.children}</div>
    </div>
  );
}

type SplitProps = {
  readonly aside: Element;
  readonly children: Element;
};
