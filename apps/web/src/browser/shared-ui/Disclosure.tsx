import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { Text } from "./Text";

export function Disclosure(props: DisclosureProps): JSX.Element {
  return (
    <details class="max-w-[56ch] border-t border-rule pt-2">
      <summary class="cursor-pointer text-control font-semibold text-ink-soft underline decoration-1 underline-offset-4 focus-visible:outline-none focus-visible:shadow-focus">
        {props.summary}
      </summary>
      <div class="pt-2">
        <Text size="caption" tone="muted">
          {props.children}
        </Text>
      </div>
    </details>
  );
}

type DisclosureProps = {
  readonly summary: string;
  readonly children: Element;
};
