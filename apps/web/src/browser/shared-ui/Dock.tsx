import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function Dock(props: { readonly id: string; readonly children: Element }): JSX.Element {
  return (
    <div
      id={props.id}
      class="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-20 max-sm:border-t max-sm:border-rule-strong max-sm:bg-canvas max-sm:ps-(--gutter-start) max-sm:pe-(--gutter-end) max-sm:pb-[max(12px,env(safe-area-inset-bottom))] max-sm:pt-3 sm:static sm:border-0 sm:bg-transparent sm:p-0"
    >
      <div class="mx-auto w-full max-w-[48rem]">{props.children}</div>
    </div>
  );
}

export function DockSpacer(props: {
  readonly active?: boolean;
  readonly children: Element;
}): JSX.Element {
  return <div class={props.active === false ? "" : "pb-88 sm:pb-0"}>{props.children}</div>;
}
