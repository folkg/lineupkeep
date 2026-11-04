import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Element } from "solid-js";

import { cx } from "./cx";

export function Notice(props: NoticeProps): JSX.Element {
  return (
    <div
      id={props.id}
      class={cx(
        "grid max-w-[42.5rem] gap-1.5 border-l ps-4",
        props.tone === "danger" ? "border-danger" : "border-rule-strong",
      )}
    >
      <p
        class={cx(
          "text-label font-semibold uppercase tracking-label",
          props.tone === "danger" ? "text-danger" : "text-ink",
        )}
      >
        {props.title}
      </p>
      <Show when={props.items}>
        {(items) => (
          <ul class="grid gap-1">
            <For each={items()}>
              {(item) => (
                <li
                  class={cx(
                    "text-caption",
                    props.tone === "danger" ? "text-danger" : "text-ink-soft",
                  )}
                >
                  {item}
                </li>
              )}
            </For>
          </ul>
        )}
      </Show>
      {props.children}
    </div>
  );
}

type NoticeProps = {
  readonly id?: string;
  readonly tone: "danger" | "neutral";
  readonly title: Element;
  readonly items?: ReadonlyArray<string>;
  readonly children?: Element;
};
