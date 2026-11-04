import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function IntroPanel(props: IntroPanelProps): JSX.Element {
  return (
    <div class="grid gap-4">
      <div class="grid gap-4">
        {props.title}
        {props.children}
      </div>
      <p class="text-caption text-ink-faint">{props.cue}</p>
    </div>
  );
}

type IntroPanelProps = {
  readonly title: Element;
  readonly cue: string;
  readonly children: Element;
};
