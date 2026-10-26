import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function Nav(props: NavProps): JSX.Element {
  return (
    <nav aria-label={props.label} class="flex flex-wrap items-center gap-0.5">
      {props.children}
    </nav>
  );
}

type NavProps = {
  readonly label: string;
  readonly children: Element;
};
