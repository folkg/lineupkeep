import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function Dock(props: { readonly id: string; readonly children: Element }): JSX.Element {
  return (
    <div
      id={props.id}
      data-sheet-settle
      class="max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-20 max-sm:bg-canvas max-sm:ps-(--gutter-start) max-sm:pe-(--gutter-end) max-sm:pb-[max(12px,env(safe-area-inset-bottom))] max-sm:pt-3 max-sm:before:pointer-events-none max-sm:before:absolute max-sm:before:inset-x-0 max-sm:before:-top-4 max-sm:before:h-4 max-sm:before:bg-linear-to-b max-sm:before:from-transparent max-sm:before:to-canvas max-sm:before:content-[''] sm:static sm:bg-transparent sm:p-0"
    >
      <div class="mx-auto w-full max-w-[42.5rem]">{props.children}</div>
    </div>
  );
}

export function DockSpacer(props: {
  readonly active?: boolean;
  readonly children: Element;
}): JSX.Element {
  return <div class={props.active === false ? "" : "pb-32 sm:pb-0"}>{props.children}</div>;
}
