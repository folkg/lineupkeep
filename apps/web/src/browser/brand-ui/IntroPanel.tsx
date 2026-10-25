import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { PanelSurface } from "#browser/shared-ui/Surface.tsx";

export function IntroPanel(props: IntroPanelProps): JSX.Element {
  return (
    <PanelSurface>
      <div class="relative flex min-h-[min(520px,calc(100svh-128px))] flex-col justify-between overflow-hidden rounded-sheet bg-panel p-[clamp(32px,5vw,60px)] text-on-panel max-md:min-h-0 max-md:gap-5 max-md:p-surface">
        <div class="relative z-[1] grid gap-6">
          {props.title}
          <div class="max-md:hidden">{props.children}</div>
        </div>
        <span
          aria-hidden="true"
          class="absolute -right-[18px] bottom-12 h-[22px] w-[150px] rotate-[-4deg] bg-accent max-md:-right-[26px] max-md:bottom-[18px]"
        />
        <div
          aria-hidden="true"
          class="relative z-[1] flex items-center gap-3 text-caption text-accent"
        >
          <span class="h-px w-[42px] bg-current" />
          <strong>{props.cue}</strong>
        </div>
      </div>
    </PanelSurface>
  );
}

type IntroPanelProps = {
  readonly title: Element;
  readonly cue: string;
  readonly children: Element;
};
