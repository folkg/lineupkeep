import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";
import { ChevronRightIcon } from "./icons";

export function Disclosure(props: DisclosureProps): JSX.Element {
  return (
    <details class="group">
      <summary class={disclosureSummaryClass}>
        <ChevronRightIcon
          class="mt-0.5 shrink-0 transition-transform group-open:rotate-90"
          size="sm"
        />
        <span class="min-w-0">{props.summary}</span>
      </summary>
      <div class="pt-2">{props.children}</div>
    </details>
  );
}

const disclosureSummaryClass = cx(
  "flex cursor-pointer list-none items-start gap-2 text-body font-semibold text-ink",
  "underline decoration-1 underline-offset-4",
  "[&::-webkit-details-marker]:hidden",
  "focus-visible:outline-none focus-visible:shadow-focus",
);

type DisclosureProps = {
  readonly summary: Element;
  readonly bordered?: boolean;
  readonly children: Element;
};
