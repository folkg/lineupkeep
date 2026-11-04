import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function PageShell(props: PageShellProps): JSX.Element {
  return (
    <div class="mx-auto flex min-h-svh w-full max-w-[42.5rem] flex-col ps-(--gutter-start) pe-(--gutter-end) text-ink">
      <header class="grid gap-y-1 border-b border-rule-strong pb-1">
        <div class="flex h-header items-center">{props.brand}</div>
        <div class="min-w-0 empty:hidden">{props.navigation}</div>
      </header>
      <main class="flex min-h-0 flex-1 flex-col">{props.children}</main>
    </div>
  );
}

type PageShellProps = {
  readonly brand: Element;

  readonly navigation: Element;
  readonly children: Element;
};
