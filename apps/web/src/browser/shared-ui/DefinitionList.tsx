import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { Text } from "./Text";

export function DefinitionList(props: { readonly children: Element }): JSX.Element {
  return (
    <dl class="grid gap-x-8 gap-y-3 border-t border-rule pt-4 sm:grid-cols-2">{props.children}</dl>
  );
}

export function Definition(props: { readonly term: string; readonly value: string }): JSX.Element {
  return (
    <div class="grid gap-1">
      <dt>
        <Text size="caption" tone="faint">
          {props.term}
        </Text>
      </dt>
      <dd>
        <Text numeric size="body">
          {props.value}
        </Text>
      </dd>
    </div>
  );
}
