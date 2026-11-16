import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function Nav(props: NavProps): JSX.Element {
  return (
    <nav
      aria-label={props.label}
      class="flex flex-wrap items-center gap-x-5 gap-y-0 max-sm:gap-x-4"
    >
      {props.children}
    </nav>
  );
}

type NavProps = {
  readonly label: string;
  readonly children: Element;
};
