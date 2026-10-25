import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function SidebarLayout(props: SidebarLayoutProps): JSX.Element {
  return (
    <div class="grid items-start gap-[clamp(24px,4vw,50px)] md:grid-cols-[minmax(300px,0.72fr)_minmax(0,1.28fr)]">
      <div class="md:sticky md:top-5">{props.sidebar}</div>
      {props.children}
    </div>
  );
}

type SidebarLayoutProps = {
  readonly sidebar: Element;
  readonly children: Element;
};
