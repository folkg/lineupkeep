import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";
import { Text } from "./Text";

export function DefinitionList(props: {
  readonly children: Element;
  readonly compact?: boolean;
}): JSX.Element {
  return (
    <dl
      class={cx(
        "grid gap-x-8 border-t border-rule sm:grid-cols-2",
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
}): JSX.Element {
  return (
    <div class={props.compact === true ? "grid gap-0" : "grid gap-1"}>
      <dt>
        <Text type="meta" tone="faint">
          {props.term}
        </Text>
      </dt>
      <dd>
        <Text numeric type="body">
          {props.value}
        </Text>
      </dd>
    </div>
  );
}
