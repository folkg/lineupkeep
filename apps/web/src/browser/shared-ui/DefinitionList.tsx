import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { Text } from "./Text";

export function DefinitionList(props: { readonly children: Element }): JSX.Element {
  return (
    <dl class="grid gap-3 border-t border-rule-strong pt-4 sm:grid-cols-2">{props.children}</dl>
  );
}

export function Definition(props: { readonly term: string; readonly value: string }): JSX.Element {
  return (
    <div class="grid gap-0.5">
      <dt>
        <Text size="caption" tone="muted">
          {props.term}
        </Text>
      </dt>
      <dd>
        <Text size="caption">{props.value}</Text>
      </dd>
    </div>
  );
}
