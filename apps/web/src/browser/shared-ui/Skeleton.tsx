import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { cx } from "./cx";
import { Inline } from "./Inline";
import { RuleList, RuleListItem } from "./RuleList";
import { Stack } from "./Stack";
import { typeClass } from "./type";
import type { TextType } from "./type";

export function TextSkeleton(props: {
  readonly type: Extract<
    TextType,
    "card-title" | "section-title" | "body" | "body-strong" | "meta" | "label"
  >;
  readonly width?: string;
}): JSX.Element {
  return (
    <span aria-hidden="true" class={cx("relative block", typeClass[props.type])}>
      <span class="invisible whitespace-nowrap">Aa</span>
      <span
        class={cx(
          "absolute left-0 top-1/2 h-[0.62em] -translate-y-1/2 animate-pulse bg-rule motion-reduce:animate-none",
          props.width ?? "w-24",
        )}
      />
    </span>
  );
}

export function ListSkeleton(props: {
  readonly count: number;
  readonly label: string;
  readonly fade?: boolean;
}): JSX.Element {
  const rows = (): number => Math.min(props.count, 3);
  return (
    <div
      aria-label={props.label}
      class={props.fade === true ? "relative" : undefined}
      role="status"
    >
      <RuleList busy>
        <For each={Array.from({ length: rows() }, () => undefined)}>
          {() => (
            <RuleListItem layout="stack" dense>
              <Stack gap="2xs">
                <Inline gap="sm">
                  <span class="size-5 shrink-0 animate-pulse bg-rule motion-reduce:animate-none" />
                  <TextSkeleton type="body-strong" width="w-3/4" />
                </Inline>
                <TextSkeleton type="meta" width="w-1/2" />
                <TextSkeleton type="meta" width="w-2/3" />
                <TextSkeleton type="meta" width="w-1/2" />
              </Stack>
            </RuleListItem>
          )}
        </For>
      </RuleList>
      <Show when={props.fade === true && rows() > 0}>
        <div
          aria-hidden="true"
          class="fade-to-canvas pointer-events-none absolute inset-x-0 bottom-0 h-16"
        />
      </Show>
    </div>
  );
}

export function BadgeSkeleton(): JSX.Element {
  return (
    <span
      aria-hidden="true"
      class="block h-6 w-20 animate-pulse bg-rule motion-reduce:animate-none"
    />
  );
}
