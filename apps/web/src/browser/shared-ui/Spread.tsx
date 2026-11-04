import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

export function Spread(props: SpreadProps): JSX.Element {
  return (
    <Show
      when={props.variant === "form"}
      fallback={
        <section class="grid w-full max-w-[42.5rem] gap-14 py-[clamp(40px,8vh,88px)]">
          <div class="min-w-0">{props.start}</div>
          {props.end}
        </section>
      }
    >
      <section class="grid w-full max-w-[42.5rem] items-start gap-10 py-[clamp(32px,7vh,72px)] md:grid-cols-2 md:gap-x-12">
        <div class="min-w-0">{props.start}</div>
        <div class="min-w-0">{props.end}</div>
      </section>
    </Show>
  );
}

type SpreadProps = {
  readonly variant: "showcase" | "form";
  readonly start: Element;
  readonly end: Element;
};
