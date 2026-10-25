import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function PageShell(props: PageShellProps): JSX.Element {
  return (
    <div class="mx-auto flex min-h-svh w-full max-w-[80rem] select-none flex-col ps-(--gutter-start) pe-(--gutter-end) text-ink">
      <header class="flex h-header basis-header items-center justify-between border-b border-ink md:h-header-wide md:basis-header-wide">
        {props.brand}
        <div class="flex items-center gap-1">{props.actions}</div>
      </header>
      <main class="flex min-h-0 flex-1 flex-col">{props.children}</main>
    </div>
  );
}

type PageShellProps = {
  readonly brand: Element;
  readonly actions: Element;
  readonly children: Element;
};
