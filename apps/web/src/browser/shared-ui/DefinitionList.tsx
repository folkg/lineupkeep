import { EffectString } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Element } from "solid-js";

import { cx } from "./cx";
import { Text } from "./Text";

export function DefinitionList(props: {
  readonly children: Element;
  readonly compact?: boolean;
  readonly paired?: boolean;
}): JSX.Element {
  return (
    <dl
      class={cx(
        "grid gap-x-8 border-t border-rule",
        props.paired === true ? "grid-cols-2 gap-x-4" : "sm:grid-cols-2",
        props.compact === true ? "gap-y-1 pt-3" : "gap-y-3 pt-4",
      )}
    >
      {props.children}
    </dl>
  );
}

export function Definition(props: {
  readonly term: string;
  readonly value: string;
  readonly compact?: boolean;
  readonly wide?: boolean;
}): JSX.Element {
  return (
    <div
      class={cx(
        props.compact === true ? "grid gap-0" : "grid gap-1",
        props.wide === true && "col-span-2 sm:col-span-1",
      )}
    >
      <dt>
        <Text type="meta" tone="muted">
          {props.term}
        </Text>
      </dt>
      <dd class="min-w-0 break-words">
        <Text type="body">
          <For each={EffectString.split(props.value, /(\d+)/u)}>
            {(part) => (
              <Show when={/^\d+$/u.test(part)} fallback={part}>
                <span class="tabular-nums">{part}</span>
              </Show>
            )}
          </For>
        </Text>
      </dd>
    </div>
  );
}
