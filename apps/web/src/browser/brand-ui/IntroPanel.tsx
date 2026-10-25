import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { PanelSurface } from "#browser/shared-ui/Surface.tsx";

export function IntroPanel(props: IntroPanelProps): JSX.Element {
  return (
    <PanelSurface>
      <div class="flex min-h-[min(480px,calc(100svh-160px))] flex-col justify-between gap-10 rounded-sheet bg-panel p-[clamp(28px,4vw,52px)] text-on-panel max-md:min-h-0 max-md:gap-4 max-md:p-6">
        <div class="grid gap-6 max-md:gap-4">
          {props.title}
          {props.children}
        </div>
        <p class="text-caption text-on-panel-soft">{props.cue}</p>
      </div>
    </PanelSurface>
  );
}

type IntroPanelProps = {
  readonly title: Element;
  readonly cue: string;
  readonly children: Element;
};
