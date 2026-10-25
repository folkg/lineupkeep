import type { JSX } from "@solidjs/web";
import { For } from "solid-js";
import type { Element } from "solid-js";

import { cx } from "#browser/shared-ui/cx.ts";

export function PromptSheet(props: PromptSheetProps): JSX.Element {
  return (
    <aside
      aria-label={props.label}
      class="animate-prompt-in relative grid min-h-[clamp(390px,57vh,510px)] grid-cols-[58px_1fr] grid-rows-[1fr_auto] overflow-hidden rounded-sheet bg-paper shadow-lift max-sm:min-h-[400px] max-sm:grid-cols-[42px_1fr]"
    >
      <div
        aria-hidden="true"
        class="row-span-2 flex rotate-180 items-center justify-between gap-4 bg-panel py-4 [writing-mode:vertical-rl] font-display text-caption font-bold tracking-rail text-on-panel"
      >
        <span>{props.rail[0]}</span>
        <span class="text-accent">{props.rail[1]}</span>
      </div>
      <div class="flex min-w-0 flex-col justify-center p-[clamp(30px,4vw,58px)] max-sm:p-[26px_22px]">
        <div class="flex items-center justify-between gap-[18px] border-b border-ink pb-3 text-metadata font-bold text-ink-faint">
          <span>{props.meta[0]}</span>
          <span>{props.meta[1]}</span>
        </div>
        <h2 class="mt-[clamp(28px,4vh,44px)] max-w-[9ch] font-display text-headline font-bold">
          {props.title}
        </h2>
        <p class="mt-5 max-w-[42ch] text-supporting text-ink-soft">{props.children}</p>
        <div
          aria-label={props.stepsLabel}
          class="mt-auto grid grid-cols-3 pt-[clamp(28px,5vh,48px)]"
        >
          <For each={props.steps}>
            {(step, index) => (
              <span
                class={cx(
                  "border-t border-ink px-2 py-2.5 text-center text-metadata font-bold max-sm:px-1",
                  index() === props.steps.length - 1
                    ? "bg-accent text-on-accent"
                    : "border-r text-ink-soft",
                )}
              >
                {step}
              </span>
            )}
          </For>
        </div>
      </div>
      <div class="flex items-center justify-between gap-[18px] border-t border-rule px-[clamp(30px,4vw,58px)] py-3.5 text-metadata font-bold text-ink-faint max-sm:px-[22px] max-sm:py-3">
        <span class="max-w-[13ch]">{props.footnote}</span>
        <strong class="text-action">{props.tag}</strong>
      </div>
    </aside>
  );
}

type PromptSheetProps = {
  readonly label: string;
  readonly rail: readonly [string, string];
  readonly meta: readonly [string, string];
  readonly title: string;
  readonly steps: ReadonlyArray<string>;
  readonly stepsLabel: string;
  readonly footnote: string;
  readonly tag: string;
  readonly children: Element;
};
