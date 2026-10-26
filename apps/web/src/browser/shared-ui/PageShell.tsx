import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function PageShell(props: PageShellProps): JSX.Element {
  return (
    <div class="mx-auto flex min-h-svh w-full max-w-[76rem] select-none flex-col ps-(--gutter-start) pe-(--gutter-end) text-ink">
      <header class="grid grid-cols-[1fr_auto] items-center border-b border-ink md:flex md:h-header-wide md:flex-nowrap md:justify-between">
        <div class="flex h-header items-center">{props.brand}</div>
        <div class="col-span-2 flex min-w-0 items-center pb-2 empty:hidden max-sm:-ms-2.5 md:order-2 md:col-span-1 md:ms-0 md:ml-auto md:pb-0">
          {props.navigation}
        </div>
        <div class="col-start-2 row-start-1 flex h-header items-center justify-self-end md:order-3">
          {props.controls}
        </div>
      </header>
      <main class="flex min-h-0 flex-1 flex-col">{props.children}</main>
    </div>
  );
}

type PageShellProps = {
  readonly brand: Element;

  readonly navigation: Element;
  readonly controls: Element;
  readonly children: Element;
};
