import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

export function PageShell(props: PageShellProps): JSX.Element {
  return (
    <div class="mx-auto flex min-h-svh w-full max-w-[42.5rem] flex-col ps-(--gutter-start) pe-(--gutter-end) text-ink">
      <header class="flex flex-wrap items-end gap-x-6 border-b-section pb-1">
        <div class="flex h-header items-center">{props.brand}</div>
        <div class="ms-auto min-w-0 max-sm:ms-0 max-sm:w-full empty:hidden">{props.navigation}</div>
      </header>
      <main class="flex min-h-0 flex-1 flex-col">{props.children}</main>
      <Show when={props.footer}>
        <footer class="border-t border-rule py-3">{props.footer}</footer>
      </Show>
    </div>
  );
}

type PageShellProps = {
  readonly brand: Element;

  readonly navigation: Element;
  readonly footer?: Element;
  readonly children: Element;
};
