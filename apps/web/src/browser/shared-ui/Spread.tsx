import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

export function Spread(props: SpreadProps): JSX.Element {
  return (
    <Show
      when={props.variant === "form"}
      fallback={
        <section class="grid flex-1 items-start gap-9 pt-10 pb-[max(64px,env(safe-area-inset-bottom))] md:min-h-[calc(100svh-var(--theme-size-header-wide))] md:grid-cols-[minmax(0,0.85fr)_minmax(440px,1.15fr)] md:items-center md:gap-[clamp(48px,7vw,108px)] md:py-[clamp(28px,5vh,58px)]">
          <div class="max-w-[680px] lg:max-w-[530px]">{props.start}</div>
          {props.end}
        </section>
      }
    >
      <section class="grid flex-1 items-center gap-[clamp(30px,6vw,88px)] py-[clamp(28px,5vh,56px)] max-md:content-start max-md:gap-0 max-md:pb-[max(64px,env(safe-area-inset-bottom))] md:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.92fr)]">
        {props.start}
        <div class="w-full max-w-[440px] justify-self-end max-md:max-w-none max-md:justify-self-stretch max-md:pt-[38px] max-sm:pt-[30px]">
          {props.end}
        </div>
      </section>
    </Show>
  );
}

type SpreadProps = {
  readonly variant: "showcase" | "form";
  readonly start: Element;
  readonly end: Element;
};
